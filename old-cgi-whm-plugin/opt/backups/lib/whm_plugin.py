"""Functions for backups.cgi in WHM"""

import functools
from contextlib import nullcontext
import logging
import json
import calendar
from pathlib import Path
import multiprocessing
import shlex
import sys
import time
import traceback
from datetime import datetime
from typing import Literal
from collections.abc import Callable
from dateutil import tz
import bakauth
import rads
from restic import Restic, ResticError
from jinja2 import StrictUndefined
from markupsafe import escape as html_escape
from flask import Flask, render_template, request, Response

sys.path.insert(0, '/opt/backups/lib')
# pylint: disable=wrong-import-position
import ipc.client
import ipc.data
from monitoring import MON_DIR, sched_proc_old
from threads import NamedThread
from usermap import UserMap
from plugins import serialize_listdir, split_hour_meridiem, refresh_backups
from plugins import join_hour_meridiem, setup_logger, merge_completed
from plugins import down_error, LOGLEVELS, UNREGISTERED
from quotas import size_cache, SYS_GRACE_MB
from errors import IPCError, PluginError
from configs import SysConf, UserConf, TaskConf, SysLoadConf
from emails import send_ticket

# pylint: enable=wrong-import-position

app = Flask(
    __name__,
    template_folder='/usr/local/cpanel/whostmgr/docroot/backups/templates',
)
app.jinja_env.undefined = StrictUndefined

PLUGIN_TIMEOUT = 30.0


def error_handler(func):
    """Wraps route_main to display error responses"""

    @functools.wraps(func)
    def _error_handler(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except PluginError as exc:
            return Response(str(exc), status=400)
        except Exception as exc:
            if isinstance(exc, bakauth.BakAuthError):
                error = f"{type(exc).__name__}: {exc}"
                if isinstance(exc, bakauth.BakAuthDown):
                    error = (
                        f"{error}\nIf outbound filtering is enabled in your "
                        "firewall, it needs to allow TCP port 4002 to "
                        "172.81.116.91 and 173.231.211.240"
                    )
            else:
                error = traceback.format_exc()
            logging.error(error)
            if request.method == 'POST':
                return Response(f'Server Error: {exc}', status=500)
            # else this was a GET
            try:
                # try to show the pretty error page
                return Response(
                    render_template('error.html', message=error), status=500
                )
            except Exception:
                # if we error on that too, just show a generic error page
                return Response(f'<pre>{html_escape(error)}</pre>', status=500)

    return _error_handler


@app.route('/', methods=['GET', 'POST'])
@error_handler
def route_main():
    """Routes flask requests to the right function"""
    setup_logger('whm_plugin', False)
    sys_conf = SysConf()
    sys_conf.set_loglevel()
    if request.method == 'GET':
        return show_form(sys_conf)
    args = json.loads(request.form.get('args', r'{}'))
    if 'action' not in request.form:
        return show_form(sys_conf)
    return Response(
        route_action(sys_conf, request.form['action'], args), status=200
    )


def get_status():
    """Render status.html"""
    try:
        probs = {}
        if sched_start := sched_proc_old():
            sched_start = sched_start.humanize()
        for entry in sorted(MON_DIR.iterdir()):
            try:
                probs[entry.name] = entry.read_text('utf-8')
            except OSError as exc:
                probs[entry.name] = f"{type(exc).__name__}: {exc}"
        status = ipc.client.cmd_status(
            procs=True, failing=False, min_hours=None, logs=True
        )
        return render_template(
            'status.html',
            probs=probs,
            sched_start=sched_start,
            now=int(time.time()),
            status=status,
            has_maint_tasks=any(status['maint_queues'].values()),
        )
    except PluginError as exc:
        return str(exc)
    except Exception:
        return f"<pre>{html_escape(traceback.format_exc())}</pre>"


def route_action(
    sys_conf: SysConf, action: str, args: dict, cwp: bool = False
) -> str:
    """Routes ajax requests - this is imported by the cwp plugin too"""
    if action == 'get_status':
        return get_status()
    if action == 'save_dirs':
        set_dirs(sys_conf, **args)
        sys_conf.save()
    elif action == 'save_mysql':
        set_db(sys_conf, 'mysql', **args)
        sys_conf.save()
    elif action == 'save_pgsql':
        if cwp:
            set_db(sys_conf, 'pgsql', cpuser_enabled=None, **args)
        else:
            set_db(sys_conf, 'pgsql', **args)
        sys_conf.save()
    elif action == 'save_all':
        set_dirs(sys_conf, **args['dirs'])
        set_db(sys_conf, 'mysql', **args['mysql'])
        if cwp:
            set_db(sys_conf, 'pgsql', cpuser_enabled=None, **args['pgsql'])
        else:
            set_db(sys_conf, 'pgsql', **args['pgsql'])
        sys_conf.save()
    elif action == 'save_tuning':
        set_tuning(sys_conf, **args)
        sys_conf.save()
    elif action == 'get_restore_queue':
        return get_restore_queue(cwp=cwp, **args)
    elif action == 'make_ticket':
        make_ticket(**args)
    elif action == 'cancel_restore':
        cancel_restore(**args)
    elif action == 'restore_dirs':
        restore_dirs(**args)
    elif action == 'restore_mysql':
        restore_db('mysql', **args)
    elif action == 'restore_pgsql':
        restore_db('pgsql', **args)
    elif action == 'browse':
        return browse(**args)
    elif action == 'set_cpuser_limits':
        set_cpuser_limits(sys_conf, **args)
        sys_conf.save()
    elif action == 'reset_settings':
        return reset(sys_conf, sys_conf.reset_backup_settings, **args)
    elif action == 'reset_storage':
        return reset(sys_conf, sys_conf.reset_user_limits, **args)
    elif action == 'reset_tuning':
        return reset(sys_conf, sys_conf.reset_tuning, **args)
    else:
        raise PluginError('Unrecognized function')
    return 'Success'


def reset(sys_conf: SysConf, reset_func: Callable, confirm: bool) -> str:
    """Handles the buttons to reset settings"""
    old_conf = vars(sys_conf)
    reset_items = reset_func()
    if confirm:
        # user confirmed to reset
        sys_conf.save()
        return 'Success'
    # else just show what would change
    return render_template(
        'reset.html',
        old_conf=old_conf,
        reset_items=reset_items,
        cores=multiprocessing.cpu_count(),
    )


def set_cpuser_limits(
    sys_conf: SysConf,
    default_limit: float,
    do_limit: bool,
    email: str,
    limits: dict[str, float],
    notify: dict[str, bool],
) -> None:
    """Sets size limits for main cPanel accounts"""
    sys_conf.user_limits.default_limit = max(float(default_limit) * 1024, 0.0)
    sys_conf.user_limits.do_limit = bool(do_limit)
    sys_conf.user_limits.email = email.strip()
    for user, limit in limits.items():
        limits[user] = max(float(limit) * 1024, 0.0)
    sys_conf.user_limits.limits = limits
    for user, do_notify in notify.items():
        notify[user] = bool(do_notify)
    sys_conf.user_limits.notify = notify
    if (
        sys_conf.user_limits.do_limit
        and any(sys_conf.user_limits.notify.values())
        and not sys_conf.user_limits.email
    ):
        raise PluginError(
            'Please enter a valid email address or disable notifications'
        )


def browse(snap: str, path: str, geo: int) -> str:
    """Used by the directory restore form to look inside a backup"""
    logging.debug('browsing snap=%r path=%r', snap, path)
    try:
        data: ipc.data.ResticConnInfo = ipc.client.restic_conn_info()
        if geo:
            endpoint = data['geo'].endpoint
            cluster_name = data['geo'].name
        else:
            endpoint = data['cluster'].endpoint
            cluster_name = data['cluster'].name
        if data['repo'] is None:
            # failed to get connection info from the daemon; collect it
            # directly from bakauth instead.
            restic = bakauth.BakAuth().get_restic(
                'root',
                geo=bool(geo),
                lim=None,
                tmp_dir=SysConf().restic_tmp,
                gomaxprocs=None,
            )
        else:
            restic = Restic(
                endpoint=endpoint,
                repo=data['repo'],
                cluster=cluster_name,
                lim=None,
                tmp_dir=SysConf().restic_tmp,
                gomaxprocs=None,
            )
        return json.dumps(
            {'status': 0, 'data': serialize_listdir(restic, snap, path)}
        )
    except ResticError as exc:
        raise PluginError(str(exc)) from exc
    except Exception as exc:
        logging.error(traceback.format_exc())
        raise PluginError(f"{type(exc).__name__}: {exc}") from exc


def make_ticket(
    log: list[tuple[int, str]], ipaddr: str, params: dict, task: str, msg: str
) -> None:
    """Create a ticket for a failed restore"""
    if not send_ticket(
        user='root',
        title=f'{task} restore for root failed',
        log=log,
        params=params,
        msg=msg,
    ):
        raise PluginError('Error sending ticket')
    bakauth.BakAuth().note_auto_ticket(
        task=task,
        plugin='WHM Backup Manager',
        user='root',
        ipaddr=ipaddr,
    )


def cancel_restore(tag: str) -> None:
    """function to cancel an ongoing restore process"""
    if not tag.startswith('restore::root::'):
        logging.error('tried to cancel invalid restore tag: %r', tag)
        raise PluginError('Invalid restore')
    try:
        ipc.client.kill_restore(tag)
    except IPCError as exc:
        raise PluginError(f'Error canceling restore. {exc}') from exc


def set_dirs(
    sys_conf: SysConf,
    *,
    enable: bool,
    paths: list[str] | None = None,
    exclude: list[str] | None = None,
    use_interval: bool | None = None,
    interval: int | None = None,
    hour: int | None = None,
    meridiem: str | None = None,
    days: list[int] | None = None,
) -> None:
    """Saves system directory backup settings"""
    if not isinstance(enable, bool):
        raise TypeError('enable must be a bool')
    sys_conf.dirs.enable = enable
    paths = [] if paths is None else [Path(x) for x in paths]
    exclude = [] if exclude is None else [Path(x) for x in exclude]
    if not enable:
        return
    if not isinstance(use_interval, bool):
        raise TypeError(f"{use_interval=}")
    set_sched(sys_conf.dirs, use_interval, interval, hour, meridiem, days)
    try:
        sys_conf.dirs.set_paths(paths, exclude)
    except ValueError as exc:
        raise PluginError(exc) from exc


def set_db(
    sys_conf: SysConf,
    dbtype: str,
    *,
    enable: bool,
    cpuser_enabled: bool = None,
    mode: Literal[None, 'all', 'whitelist', 'blacklist'] = None,
    custom: list[str] | None = None,
    use_interval: bool | None = None,
    interval: int | None = None,
    hour: int | None = None,
    meridiem: str | None = None,
    days: list[int] | None = None,
) -> None:
    """Saves database backup settings"""
    conf_section: TaskConf = getattr(sys_conf, dbtype)
    if not isinstance(enable, bool):
        raise TypeError('enable must be a bool')
    conf_section.enable = enable
    if cpuser_enabled is not None and not isinstance(cpuser_enabled, bool):
        raise TypeError('cpuser_enabled must be a bool or null')
    setattr(sys_conf.cpuser_enable, dbtype, cpuser_enabled)
    sys_conf.check_dbs_installed()
    if not enable:
        return
    if mode not in ('all', 'whitelist', 'blacklist'):
        raise ValueError('invalid backup mode: {mode!r}')
    if mode == 'all':
        conf_section.set_mode_all()
    else:
        try:
            conf_section.set_mode_custom(mode, custom, plugin=True)
        except ValueError as exc:
            raise PluginError(exc) from exc
    if not isinstance(use_interval, bool):
        raise TypeError(f"{use_interval=}")
    set_sched(conf_section, use_interval, interval, hour, meridiem, days)


def set_sched(
    conf_section: TaskConf,
    use_interval: int,
    interval: int | None = None,
    hour: int | None = None,
    meridiem: str | None = None,
    days: list[int] | None = None,
) -> None:
    """Helper for set_dirs and set_dbs that handles scheduling settings"""
    if not isinstance(use_interval, bool):
        raise TypeError('use_interval must be a bool')
    if use_interval:
        conf_section.set_interval(interval)
    else:
        conf_section.set_times(
            hour=join_hour_meridiem(hour, meridiem), days=days
        )


def set_tuning(
    sys_conf: SysConf,
    loglevel: Literal['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'],
    bwlimit: int,
    backups: dict,
    backup_parallel: dict,
    restore_parallel: dict,
    restic_tmp: str,
    plugin_du_timeout: int,
    max_cpus: int,
    restore: dict | None = None,
    pre_cache: dict | None = None,
    pre_cache_parallel: dict | None = None,
) -> None:
    """Save button on the performance tuning tab"""
    bwlimit = int(bwlimit)
    if bwlimit < 0:
        raise PluginError('invalid bandwidth limit')
    sys_conf.bwlimit = bwlimit
    if loglevel not in LOGLEVELS:
        raise PluginError('invalid loglevel')
    sys_conf.loglevel = loglevel
    plugin_du_timeout = int(plugin_du_timeout)
    if plugin_du_timeout < 0:
        raise PluginError('invalid plugin du timeout')
    sys_conf.plugin_du_timeout = plugin_du_timeout
    max_cpus = int(max_cpus)
    if max_cpus < 0:
        raise PluginError('invalid max cpus')
    sys_conf.max_cpus = max_cpus
    if not restic_tmp.startswith('/'):
        raise PluginError('temp folder must be a full path')
    sys_conf.restic_tmp = restic_tmp
    _set_tuning_load(sys_conf.backup_load, **backups)
    if restore is not None:
        _set_tuning_load(sys_conf.restore_load, **restore)

    def _set_parallel(parallel_section, val, mult):
        if mult:
            parallel_section.set_mult(val)
        else:
            parallel_section.set_max(val)

    if not rads.vz.is_vps():
        _set_parallel(sys_conf.parallel.backup, **backup_parallel)
        _set_parallel(sys_conf.parallel.restore, **restore_parallel)
        _set_parallel(sys_conf.parallel.pre_cache, **pre_cache_parallel)
        _set_tuning_load(sys_conf.pre_cache_load, **pre_cache)


def _set_tuning_load(
    load_section: SysLoadConf,
    peak_hours: list[int],
    off_load: float,
    peak_load: float,
    sleep_secs: int,
    run_secs: int,
    off_mult: bool = False,
    peak_mult: bool = False,
) -> None:
    if [x for x in peak_hours if int(x) < 0 or int(x) > 23]:
        raise ValueError('invalid peak hours')
    load_section.peak_hours = [int(x) for x in peak_hours if 0 <= int(x) <= 23]
    sleep_secs = int(sleep_secs)
    if sleep_secs < 0 or sleep_secs > 180:
        raise PluginError('sleep seconds must be between 0 and 180')
    load_section.sleep_secs = sleep_secs
    run_secs = int(run_secs)
    if run_secs < 0 or run_secs > 180:
        raise PluginError('run seconds must be between 0 and 180')
    load_section.run_secs = run_secs
    off_load = float(off_load)
    peak_load = float(peak_load)
    if peak_mult:
        load_section.peak.set_mult(peak_load)
    else:
        load_section.peak.set_max(peak_load)
    if off_mult:
        load_section.off.set_mult(off_load)
    else:
        load_section.off.set_max(off_load)


def restore_dirs(
    paths: list[str],
    mode: Literal['target', 'merge'],
    date: int,
    snap_id: str,
    email: str,
    geo: int,
    target: str | None = None,
) -> None:
    """Queues system directory restores"""
    if mode not in ('target', 'merge'):
        raise ValueError('invalid restore method')
    if not isinstance(paths, list):
        raise TypeError('invalid type for "paths"')
    if not snap_id or not date:
        raise PluginError('No "Restore from date" selected')
    if not paths:
        raise PluginError('No items supplied to restore')
    kwargs = {}
    if mode == 'target':
        if not isinstance(target, str) or not target.startswith('/'):
            raise PluginError('"Restore to" must be a full path')
        kwargs['target'] = target
    if not email:  # blank string
        email = None
    ipc.client.add_restore_item(
        user='root',
        task='dirs',
        date=int(date),
        snap_id=snap_id,
        geo=bool(geo),
        mode=mode,
        paths=paths,
        email=email,
        **kwargs,
    )


def restore_db(
    task: Literal['mysql', 'pgsql'],
    snap_id: str,
    date: int,
    dbname: str,
    target: str,
    geo: int,
    mode: Literal['target', 'dump_import'],
    email: str,
):
    """Queues a database restore"""
    if mode not in ('target', 'dump_import'):
        raise PluginError('Bug: invalid restore method')
    if task not in ('mysql', 'pgsql'):
        raise PluginError('Bug: invalid database type')
    if not snap_id or not date or not dbname:
        raise PluginError('No database selected')
    if not isinstance(target, str) or not target.startswith('/'):
        raise PluginError('"Restore to" must be a full path')
    if not email:  # blank string
        email = None
    ipc.client.add_restore_item(
        user='root',
        task=task,
        date=int(date),
        geo=bool(geo),
        mode=mode,
        snap_id=snap_id,
        dbname=dbname,
        target=target,
        email=email,
    )


def show_form(sys_conf: SysConf) -> Response | str:
    """Main function to show the page (but not change anything yet)"""
    try:
        auth_api = bakauth.BakAuth()
    except bakauth.Unregistered as exc:
        logging.error(exc)
        return Response(
            render_template('error.html', message=UNREGISTERED), status=500
        )
    try:
        ipc_data: ipc.data.WhmData = ipc.client.whm_plugin_data()
        svr_class = ipc_data['svr_class']
        completed = ipc_data['completed']
        geo_completed = ipc_data['geo_completed']
        is_shared = ipc_data['is_shared']
        restore_queue = ipc_data['restore_queue']
        cluster = ipc_data['cluster']
        geo = ipc_data['geo']
    except IPCError as exc:
        logging.error(exc)
        return Response(
            render_template('error.html', message=str(exc)),
            status=500,
        )
    if is_shared:
        quota_gb = None
        geo_sub = True
    else:
        quota_gb, geo_sub = auth_api.get_vded_quota_v2(
            nocache=True, timeout=PLUGIN_TIMEOUT, retries=0
        )
    try:
        if completed is None or (geo_sub and geo_completed is None):
            reg = bakauth.BakAuth().get_reg_details()
            new, geo_new = refresh_backups(
                cluster=ipc.data.Cluster(
                    endpoint=reg['endpoint'],
                    name=reg['name'],
                    location=reg['location'],
                ),
                geo=ipc.data.Cluster(
                    endpoint=reg['copy']['endpoint'],
                    name=reg['copy']['name'],
                    location=reg['copy']['location'],
                ),
                sys_conf=sys_conf,
                repo=reg['repo'],
                user_map=UserMap(reg['svr_class']),
                user='root',
            )
            completed = None if new is None else new['root']
            geo_completed = None if geo_new is None else geo_new['root']
        down = False
    except Exception as exc:
        logging.error(exc)
        down = True
    user_map = UserMap(svr_class)
    if is_shared:
        user_buckets: bakauth.UserBuckets = auth_api.get_user_buckets(
            users=user_map.main_users,
            wait_mins=0,
            timeout=PLUGIN_TIMEOUT,
        )
        # amp_users is the users says amp belong here per billing details
        amp_users = list(user_buckets['repos'].keys())
        amp_users.extend(user_buckets['missing'])
        # collect users found which don't belong (recent move?)
        extra_users = [x for x in user_map.main_users if x not in amp_users]
        # on shared, we show the sizes of all users which are assigned here
        show_sizes = amp_users
    else:
        # on v/ded, we show all main users
        show_sizes = user_map.main_users
        extra_users = []
        if quota_gb == 0:
            return render_template('zero_quota.html', svr_class=svr_class)
    if svr_class == 'imh_vps':
        cores = 1
    else:
        cores = multiprocessing.cpu_count()
    sys_conf.dirs.shuffle(sys_conf)
    sys_conf.mysql.shuffle(sys_conf)
    sys_conf.pgsql.shuffle(sys_conf)
    cpuser_sizes = get_cpuser_sizes(show_sizes, user_map)
    sys_cache = size_cache.SysCache()
    is_shared = svr_class in bakauth.SHARED_CLASSES
    whm_limits = sys_conf.user_limits.get_limits(user_map.main_users)
    cpuser_total = 0
    for user, size in cpuser_sizes.items():
        if size is None:
            continue  # size not known
        if whm_limits[user] is None:
            cpuser_total += size  # no limit for this user
            continue
        limit = whm_limits[user]
        if limit == 0:
            continue  # backups are disabled for this user through WHM
        if size > limit:
            # this user is over their WHM limit
            cpuser_total += limit
        else:
            cpuser_total += size
    # completed task types for the other coast that can be shown in the UI
    if geo_completed:
        geo_types = [x for x in geo_completed.keys() if x != 'pkgacct']
    else:
        geo_types = []
    return render_template(
        'backups.html',
        svr_class=svr_class,
        salt_managed=is_shared,
        is_shared=is_shared,
        sys_conf=sys_conf,
        cores=cores,
        restore_queue=restore_queue,
        down_error=down_error(
            completed=completed,
            geo_completed=geo_completed,
            cluster=cluster,
            geo=geo,
            down=down,
            geo_sub=geo_sub,
        ),
        cluster=cluster,
        geo=geo,
        show_geo=bool(geo_sub or geo_types),
        week=list(calendar.day_name),
        completed=merge_completed(completed, geo_completed),
        db_sizes=size_cache.RootLiveCache(),
        tzone=datetime.now(tz.tzlocal()).strftime('%Z'),
        quota_gb=quota_gb,
        sys_cache=sys_cache,
        cpuser_sizes=cpuser_sizes,
        dir_sizes=dir_size_labels(sys_conf, sys_cache),
        extra_users=extra_users,
        prev_tags_loaded=[],
        sys_grace_mb=SYS_GRACE_MB,
        cpuser_total=cpuser_total,
    )


def dir_size_labels(sys_conf: SysConf, sys_cache: size_cache.SysCache):
    """Form path size labels for the sys path settings form"""
    dir_sizes = {}
    for path, size in sys_cache.dir_items.items():
        dir_sizes[path] = f'({float(size) / 1024:.2f} GiB)'
    for path in sys_conf.dirs.paths:
        if path not in dir_sizes:
            if Path(path).exists():
                dir_sizes[path] = ""  # could not calculate; likely timed out
            else:
                dir_sizes[path] = '(0.00 GiB)'  # missing, therefore 0
    return dir_sizes


def get_cpuser_sizes(
    main_users: list[str], user_map: UserMap
) -> dict[str, int | None]:
    """Get the cached size for all main cPanel accounts"""
    sizes = {x: None for x in main_users}

    def _get_cpuser_size(user):
        try:
            conf = UserConf(user)
            children = user_map.get_children(user)
            cache = size_cache.UserCache(conf.homedir_path)
            if cache.expire_time != 0:
                sizes[user] = int(
                    cache.user_total
                    + cache.child_total(conf.child.get_limits(children))
                )
            else:
                logging.warning('No cached size for %s', user)
        except Exception:
            logging.error(traceback.format_exc())

    threads = []
    for user in sizes:
        threads.append(NamedThread(_get_cpuser_size, args=(user,)))
    for thread in threads:
        thread.join()
    return sizes


def get_restore_queue(prev_tags_loaded: list[str], cwp: bool = False) -> str:
    """Get the restore queue to refresh that part of the form only"""
    ctx = app.app_context if cwp else nullcontext
    with ctx():
        return render_template(
            'restore_queue.html',
            prev_tags_loaded=prev_tags_loaded,
            restore_queue=ipc.client.get_restore_queue('root'),
        )


@app.context_processor
def add_processors():
    """Adds helper functions to Jinja2"""
    return {
        'split_hour': split_hour_meridiem,
        'paths_same': lambda x, y: set(x) == set(y),
        'date_select_label': date_select_label,
    }


def date_select_label(
    geo_sub: bool,
    geo: ipc.data.Cluster,
    cluster: ipc.data.Cluster,
    backup: dict,
):
    """Formats labels for the date <select> in restore forms"""
    when = stamp2date(backup['time'])
    if not geo_sub:
        return when
    if backup['geo']:
        return f"{when} - {geo.location}"
    return f"{when} - {cluster.location}"


@app.template_filter()
def stamp2date(stamp: int) -> str:
    """Convert a unix timestamp to a human date string"""
    return datetime.fromtimestamp(stamp).strftime(r'%b %d, %Y %-I%p')


@app.template_filter()
def shlex_join(cmd: list[str]) -> str:
    """use shlex.join"""
    return shlex.join(cmd)


@app.template_filter()
def hour2timespan(hour: int) -> str:
    """Formats time for the 'select peak hours' part of the WHM form"""
    task_hour, meridiem = split_hour_meridiem(hour)
    # outputs like "08:00AM to 08:59AM"
    return f'{task_hour:0>2}:00{meridiem} to {task_hour:0>2}:59{meridiem}'


@app.template_filter()
def has_items(dict_obj: dict, key: str) -> bool:
    """Checks if a dict key exists and is not empty"""
    return bool(dict_obj and key in dict_obj and dict_obj[key])


@app.template_filter()
def hour_from_24(hour24: int) -> str:
    """Converts an hour from int(24hr format) to 12h/am"""
    hour12, meridiem = split_hour_meridiem(hour24)
    return f"{hour12} {meridiem}"


@app.template_filter()
def days_from_ints(ints: list[int]) -> list[str]:
    """Converts a list of ints to the day names they represent"""
    days = list(calendar.day_abbr)
    ints = sorted(list(set(ints)))
    names = []
    for num in ints:
        try:
            names.append(days[num])
        except IndexError:
            names.append('??')
    return names


@app.template_test('conf_sched')
def is_conf_sched(obj: object) -> bool:
    """register an 'is conf_sched' test in Jinja"""
    return isinstance(obj, dict) and 'use_interval' in obj


@app.template_test('conf_dict')
def is_conf_dict(obj: object) -> bool:
    """register an 'is conf_dict' test in Jinja"""
    return isinstance(obj, dict) and obj and 'multiply_cores' not in obj


@app.template_test('conf_mult')
def is_conf_mult(obj: object) -> bool:
    """register an 'is conf_mult' test in Jinja"""
    return isinstance(obj, dict) and 'multiply_cores' in obj


@app.template_test('list')
def is_list(obj: object) -> bool:
    """register an 'is list' test in Jinja"""
