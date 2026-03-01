// code: language=javascript insertSpaces=True tabSize=4
/* Internet Explorer 11 lacks String.startsWith() */
if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(searchString, position) {
        position = position || 0;
        return this.substr(position, searchString.length) === searchString;
    };
}
/* Internet Explorer 8 lacks Array.indexOf */
if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function(what, i) {
        i = i || 0;
        var L = this.length;
        while (i < L) {
            if (this[i] === what) return i;
            ++i;
        }
        return -1;
    };
}

/* Add [].remove */
Array.prototype.remove = function() {
    var what, a = arguments,
        L = a.length,
        ax;
    while (L && this.length) {
        what = a[--L];
        while ((ax = this.indexOf(what)) !== -1) {
            this.splice(ax, 1);
        }
    }
    return this;
};

function bySortedValue(obj, callback, context) {
    // get a list of keys, sorted by their value, descending
    var keys = [];
    for (var key in obj) keys.push(key);
    keys.sort(function(a, b) { return obj[b] - obj[a] });
    for (var i = 0; i < keys.length; i++) {
        callback.call(context, keys[i], obj[keys[i]]);
    }
}

/* get all checked items in a file browser by its ID */
function get_browser_selected(id) {
    var unshown_selections = $j(id).data('unshown-selections');
    var hex_slash = ($j(id).data('post-action') == 'listdir');
    var shown = [];
    var selected = [];
    // get the list of selected folders
    $j.each($j(id.concat(' :input')), function(i, input) {
        var input = $j(input);
        shown.push(input.val());
        if (input.is(':checked')) {
            selected.push(input.val());
        }
    });
    // remove any items from unshown_selections which the browser has loaded,
    // then add the remaining to selected
    $j.each(unshown_selections, function(i, unshown_item) {
        if (shown.indexOf(unshown_item) != -1) {
            unshown_selections.remove(unshown_item);
        }
    });
    $j.each(unshown_selections, function(i, unshown_item) {
        selected.push(unshown_item);
    });
    // iterate over them again to set .prop('indeterminate', true) as needed
    $j.each($j(id.concat(' :input')), function(i, input) {
        var input = $j(input);
        if (input.is(':checked')) {
            input.prop('indeterminate', false);
        } else { // if this item is unchecked
            var indeterminate = false;
            var unchecked_path = input.val();
            $j.each(selected, function(sel_i, selected_item) {
                // if selected_item is a child of unchecked_path, it should be set to indeterminate
                // example: unchecked_path="/root" and selected_item="/root/something/something"
                if (is_parent_path(unchecked_path, selected_item, hex_slash)) {
                    indeterminate = true;
                }
            });
            input.prop('indeterminate', indeterminate);
        }
    });
    return selected;
}

/* check if all items were selected */
function all_selected(id) {
    var inputs = $j(id.concat(' :input'));
    for (let i = 0; i < inputs.length; i++) {
        if (! $j(inputs[i]).is(':checked')){
            return false;
        }
    }
    return true;
}

function is_parent_path(parent, child, hex_slash) {
    // ensure one and only one trailing slash
    if (hex_slash) {
        // '2f' = utf-8 of '/' in hex
        var child = child.replace(/(?:2f)+$/, "").concat('2f');
        var parent = parent.replace(/(?:2f)+$/, "").concat('2f');
    } else {
        var child = child.replace(/[\/]+$/, "").concat('/');
        var parent = parent.replace(/[\/]+$/, "").concat('/');
    }
    if (child == parent) {
        return false;
    }
    return child.startsWith(parent);
}

/* called when document is ready, this is called */
function init_file_browse(browser_id, snap, geo) {
    // this tracks which folders are currently trying to fetch contents
    // to prevent unnecssary API calls
    var browser_div = $j(browser_id);
    browser_div.data('processing', []);
    var post_uri = browser_div.data('post-uri');
    var action = browser_div.data('post-action');
    if (action == 'listdir') {
        // loading items from local disk
        init_from_local_listdir(browser_div);
    } else {
        // loading items from restic
        init_from_restic_browse(action, post_uri, browser_div, snap, geo);
    }
}

function hex2str(hex) {
    var pairs = hex.match(/(..?)/g);
    var arr = [];
    $j.each(pairs, function(i, pair) {
        arr.push(parseInt(pair, 16));
    });
    return new TextDecoder().decode(new Uint8Array(arr));
};

function init_from_local_listdir(browser_div) {
    var all_sizes = $j('#settings_tab').data('subpaths')
    var browser_id = browser_div.attr('id');
    var selections = browser_div.data('orig-selections');
    browser_div.empty();
    // create the main ul where file/folders are displayed
    var ul = $j('<ul>', { style: 'list-style-type: none;' });
    bySortedValue($j('#settings_tab').data('home-items').dirs, function(dir, size_mb) { // for each directory
        var checked = selections.indexOf(dir) != -1;
        if (checked) selections.remove(dir);
        all_sizes[dir] = size_mb;
        ul.append(create_browser_li({ browser_id: browser_id, folder: true, path: dir, toplevel: true, size: size_mb, checked: checked }));
    });
    bySortedValue($j('#settings_tab').data('home-items').files, function(path, size_mb) { // for each file
        var checked = selections.indexOf(path) != -1;
        if (checked) selections.remove(path);
        all_sizes[path] = size_mb;
        ul.append(create_browser_li({ browser_id: browser_id, folder: false, path: path, toplevel: true, size: size_mb, checked: checked }));
    });
    browser_div.append(ul);
    // Any selections previously made which haven't been expanded yet
    browser_div.data('unshown-selections', selections);
    browser_div.data('all-sizes', all_sizes);
}

function init_from_restic_browse(action, post_uri, browser_div, snap, geo) {
    var browser_id = browser_div.attr('id');
    browser_div.data('unshown-selections', []); // not relevant to restic's browser; just set it empty
    browser_div.empty();
    if (snap == undefined) {
        console.log('There appears to be no file backups to browse; not initializing the browser widget');
        return;
    }
    var temp_p = $j('<p>', { text: 'Loading ', class: 'browser-msg' });
    temp_p.append($j('<img>', { src: window.filebrowse_img_root.concat('/spinner.gif') }));
    browser_div.append(temp_p);
    var home = browser_div.data('home-path');
    var post_args = JSON.stringify({ path: home, snap: snap, geo: geo });
    $j.ajax({
        url: post_uri,
        type: 'POST',
        timeout: 120 * 1000,
        data: { action: action, args: post_args }
    })
        .done(function(data) {
            try {
                data = JSON.parse(data);
                console.log(data);
            } catch (err) {
                browser_div.append($j('<p>', { text: 'Invalid JSON from server', class: 'browser-msg text-danger' }));
                console.log('could not decode server response as JSON: '.concat(data));
                return;
            }
            browser_div.empty();
            if (data.status != 0) { // successfully contacted server, but ran into an error
                browser_div.append($j('<p>', { text: data.data }));
                console.log(data);
                return;
            }
            // create the main ul where file/folders are displayed
            var ul = $j('<ul>', { style: 'list-style-type: none;' });
            $j.each(data.data.dirs, function(dir_index, dir) { // for each directory
                if (home == '/') {
                    var path = home.concat(dir);
                } else {
                    var path = home.concat('/').concat(dir);
                }
                ul.append(create_browser_li({ folder: true, browser_id: browser_id, snap: snap, geo: geo, path: path, toplevel: true }));
            });
            $j.each(data.data.files, function(file_index, file) { // for each file
                if (home == '/') {
                    var path = home.concat(file);
                } else {
                    var path = home.concat('/').concat(file);
                }
                ul.append(create_browser_li({ folder: false, browser_id: browser_id, path: path, toplevel: true }));
            });
            browser_div.append(ul);
        })
        .fail(function (xhr, statusText, errorThrown) { // could not contact server
            console.log(xhr);
            console.log(errorThrown);
            temp_p.text('Server error - '.concat(statusText));
        });
}

function update_sel_count() {
    $j('.filebrowser-count').each(function(index, span) {
        var span = $j(span);
        var browser_name = span.data('browser');
        var num_items = get_browser_selected(browser_name).length;
        span.text(num_items);
        if (num_items > 0) {
            span.parent().removeClass('count-zero');
        } else {
            span.parent().addClass('count-zero');
        }
        var has_items_func = window[span.data('has-items-func')];
        has_items_func(num_items > 0);
    });
}

/* create a <li> for the browser. params:
  folder: whether this is a folder which can be expanded
  browser_id: id for the browser div (only if folder=true)
  snap: optional snapshot ID to set in data for the li
  path: file/folder path
  checked: whether to set prop checked (default: false)
  toplevel: whether to include the browser-toplevel class (default: false)
  size: size to display for the item (optional) */
function create_browser_li(opts) {
    var post_action = $j('#'.concat(opts.browser_id)).data('post-action');
    if (post_action == 'listdir') {
        var path = hex2str(opts.path);
    } else {
        var path = opts.path;
    }
    if (opts.size === undefined) {
        var label = path;
    } else if (opts.size === null) {
        var label = path;
    } else {
        var label = path.concat(' (').concat((opts.size / 1024).toFixed(2)).concat('GB)');
    }
    var li_args = {};
    if (opts.toplevel) li_args['class'] = 'browser-toplevel';
    if (opts.folder) {
        li_args['style'] = 'list-style-image: url("'.concat(window.filebrowse_img_root).concat('/directory.png")');
        li_args['onclick'] = 'browse_expand(event, this);';
    } else {
        li_args['style'] = 'list-style-image: url("'.concat(icon_for(path)).concat('")');
    }
    var check_label = $j('<label>', { text: label });
    var check_input = $j('<input>', { type: 'checkbox', value: opts.path, onclick: 'update_checked(this)' });
    if (opts.checked) check_input.prop('checked', true);
    if (!(opts.size === undefined)) {
        if (opts.size === null) {
            check_input.data('size', '?');
        } else {
            check_input.data('size', opts.size);
        }
    }
    var li = $j('<li>', li_args);
    li.data('path', opts.path);
    li.data('browser_id', opts.browser_id);
    if (!(opts.snap === undefined)) {
        li.data('snap', opts.snap);
        li.data('geo', opts.geo);
    }
    var check_div = $j('<div>', { class: 'checkbox' });
    check_label.append(check_input);
    check_div.append(check_label);
    li.append(check_div);
    return li;
}

/* triggers when a checkbox is clicked */
function update_checked(checkbox) {
    checkbox = $j(checkbox);
    var file_browse = checkbox.closest('.file_browse');
    var path = checkbox.val();
    var checked = checkbox.is(':checked');
    // when a checkbox is manually checked:
    //  - check all items underneath it
    // when a checkbox is manually unchecked
    //  - uncheck all items underneath it
    //  - uncheck all items above it. update_sel_count() will then set them as indeterminate
    if (file_browse.data('post-action') == 'listdir') {
        var slash = '2f'; // utf-8 of '/' in hex
    } else {
        var slash = '/';
    }
    file_browse.find(' :input').each(function(i, check) {
        var check = $j(check);
        if (check.val() != path && check.val().startsWith(path.concat(slash))) {
            check.prop('checked', checked);
        }
        if (!checked && check.val() != path && path.startsWith(check.val().concat(slash))) {
            check.prop('checked', false);
        }
    });
    update_sel_count();
}

/* show an alert div for errors */
function show_browser_error(alert_div, msg, full_error) {
    console.log(full_error);
    alert_div.find('span').text(msg);
    alert_div.removeClass('hidden');
    alert_div.show();
}

/* expands a folder when clicked for the first time */
function browse_expand(event, li_item) {
    if (event.target.tagName == 'LABEL') {
        return; // it triggers twice if the label part of the checkbox is clicked
    }
    if (event.target.tagName == 'INPUT') {
        // the checkbox triggered this, not the li
        update_checked($j(event.target));
        return;
    }
    li_item = $j(li_item);
    var path = li_item.data('path');
    var snap = li_item.data('snap');
    var geo = li_item.data('geo');
    var browser_id = li_item.data('browser_id');
    if (li_item.data('open') == 'y') { // already populated the items
        if (li_item.data('expanded') == 'y') { // expanded - hide the items beneath it
            expand_item(li_item, false);
        } else { // items hidden - show them again
            expand_item(li_item, true);
        }
        return;
    }
    var browser_div = $j('#'.concat(browser_id));
    var processing = browser_div.data('processing');
    if (processing.indexOf(path) != -1) {
        console.log(browser_id.concat(' is already processing a request for ').concat(path));
        return;
    } else {
        processing.push(path);
        browser_div.data('processing', processing);
    }
    li_item.css('list-style-image', 'url("'.concat(window.filebrowse_img_root).concat('/spinner.gif")'));
    var browser_div = $j('#'.concat(browser_id));
    var action = browser_div.data('post-action');
    if (action == 'listdir') {
        var post_args = JSON.stringify({ path: path });
    } else {
        var post_args = JSON.stringify({ path: path, snap: snap, geo: geo });
    }
    var post_uri = browser_div.data('post-uri');
    $j.ajax({
        url: post_uri,
        type: 'POST',
        timeout: 120 * 1000,
        data: { action: action, args: post_args }
    })
        .done(function(data) {
            try {
                data = JSON.parse(data);
            } catch (err) {
                show_browser_error(
                    $j(li_item.closest('.file_browse').data('errors')),
                    'Error browsing '.concat(path).concat(': error - invalid JSON from server'),
                    data
                );
                return;
            }
            if (data.status != 0) { // successfully contacted server, but ran into an error
                show_browser_error(
                    $j(li_item.closest('.file_browse').data('errors')),
                    'Error browsing '.concat(path).concat(': ').concat(data.error),
                    data
                );
                return;
            }
            // update data-all-sizes on the browser div
            if (action == 'listdir') {
                var all_sizes = browser_div.data('all-sizes');
                $j.each(data.data.dirs, function(path, size) {
                    all_sizes[path] = size;
                });
                $j.each(data.data.files, function(path, size) {
                    all_sizes[path] = size;
                })
                browser_div.data('all-sizes', all_sizes);
            }
            var next_li = $j('<li>');
            var ul = $j('<ul>', { style: 'list-style-type: none;' });
            var empty = true;
            var check_new_items = li_item.find(' :input').is(':checked');
            var unshown_selections = browser_div.data('unshown-selections');
            $j.each(data.data.dirs, function(key, val) { // for each directory
                if (action == 'listdir') { // local listdir returns a dict of {dir:size}
                    var dir = key;
                    var size = val;
                    var this_path = dir;
                } else { // restic browse returns a list of dirs
                    var dir = val;
                    var size = undefined;
                    var this_path = path.concat('/').concat(dir);
                }
                empty = false;
                var check = check_new_items;
                if (unshown_selections.indexOf(this_path) != -1) {
                    var check = true;
                }
                ul.append(create_browser_li({ folder: true, browser_id: browser_id, snap: snap, geo: geo, path: this_path, size: size, checked: check }));
            });
            $j.each(data.data.files, function(key, val) { // for each file
                if (action == 'listdir') { // local listdir returns a dict of {file:size}
                    var file = key;
                    var size = val;
                    var this_path = file;
                } else { // restic browse returns a list of files
                    var file = val;
                    var size = undefined;
                    var this_path = path.concat('/').concat(file);
                }
                empty = false;
                var check = check_new_items;
                if (unshown_selections.indexOf(this_path) != -1) {
                    var check = true;
                }
                ul.append(create_browser_li({ folder: false, browser_id: browser_id, path: this_path, size: size, checked: check }));
            });
            if (li_item.data('open') != 'y') {
                li_item.data('open', 'y');
                li_item.data('expanded', 'y');
                next_li.append(ul)
                li_item.after(next_li);
                li_item.css('list-style-image', 'url("'.concat(window.filebrowse_img_root).concat('/folder_open.png")'));
                var dir_label = li_item.first('checkbox');
                if (empty) {
                    dir_label.text(dir_label.text().concat(' (empty)'));
                }
            }
        })
        .fail(function(data) { // could not contact server
            show_browser_error(
                $j(li_item.closest('.file_browse').data('errors')),
                'Error browsing '.concat(path).concat(': ').concat(data.statusText),
                data
            );
            li_item.css('list-style-image', 'url("'.concat(window.filebrowse_img_root).concat('/directory.png")'));
        })
        .always(function() {
            var processing = browser_div.data('processing');
            processing.remove(path);
            browser_div.data('processing', processing);
        });
}

/* expand (or hide) an already opened folder */
function expand_item(li_elem, expand) {
    var inner_li = li_elem.next('li');
    if (expand) { // items hidden - show them again
        inner_li.show();
        li_elem.data('expanded', 'y');
        li_elem.css('list-style-image', 'url("'.concat(window.filebrowse_img_root).concat('/folder_open.png")'));
    } else { // expanded - hide the items beneath it
        inner_li.hide();
        li_elem.css('list-style-image', 'url("'.concat(window.filebrowse_img_root).concat('/directory.png")'));
        li_elem.data('expanded', 'n');
    }
}

/* when the select all or deselect all button is clicked */
function filebrowser_selectall(browser_id, checked) {
    var browser_div = $j(browser_id);
    browser_div.find('li').each(function(li_index, li) {
        li = $j(li);
        if (checked) { // selecting all
            if (li.hasClass('browser-toplevel')) {
                $j(li.find('input')).prop('checked', true);
                update_checked($j(li.find('input')));
            }
            if (li.data('expanded') == 'y') {
                expand_item(li, false);
            }
        } else { // deselecting all
            $j(li.find('input')).prop('checked', false);
            update_checked($j(li.find('input')));
        }
    });
    update_sel_count();
}

/* get the icon that should be displayed for a file.
 * directories are different and should be directory.png or folder_open.png */
function icon_for(filename) {
    var ext = filename.substr(filename.lastIndexOf('.') + 1);
    // unused: file-lock.png, directory-lock.png
    var file_browse_extensions = {
        'rtf': 'txt',
        'gz': 'zip',
        'jpeg': 'picture',
        '4fb': 'flash',
        'mp4': 'picture',
        'mp2': 'film',
        'mp3': 'music',
        'm4p': 'film',
        'jar': 'java',
        'wmv': 'film',
        'wml': 'html',
        'm4b': 'music',
        'wma': 'music',
        'm4a': 'music',
        'bin': 'application',
        'mpg': 'film',
        'mpe': 'film',
        'cpio': 'zip',
        'psd': 'psd',
        'mpv': 'film',
        'tif': 'picture',
        'f4p': 'flash',
        'bat': 'script',
        'gifv': 'film',
        'f4v': 'flash',
        'f4a': 'flash',
        'pbm': 'picture',
        'htm': 'html',
        'webm': 'film',
        'webp': 'picture',
        'mpeg': 'film',
        'm2v': 'film',
        'rb': 'ruby',
        'cgi': 'script',
        'js': 'script',
        'plx': 'script',
        'bz': 'zip',
        'c': 'code',
        's7z': 'zip',
        'iso': 'zip',
        'pdf': 'pdf',
        'tiff': 'picture',
        'pgm': 'picture',
        'ppm': 'picture',
        'xz': 'zip',
        'txt': 'txt',
        'doc': 'doc',
        'pp': 'code',
        'vob': 'film',
        'zip': 'zip',
        'py': 'script',
        'swf': 'flash',
        'gif': 'picture',
        'wav': 'music',
        'pl': 'script',
        'phtml': 'html',
        'ogv': 'film',
        'pnm': 'picture',
        'flac': 'music',
        'ogg': 'film',
        'oga': 'music',
        'png': 'picture',
        'aac': 'music',
        'flv': 'flash',
        'erb': 'ruby',
        'cab': 'zip',
        'z': 'zip',
        'tar': 'zip',
        '3g2': 'film',
        'jpg': 'picture',
        'ar': 'zip',
        'rar': 'zip',
        'avi': 'film',
        'vox': 'music',
        '7z': 'zip',
        'shtml': 'html',
        'bz2': 'zip',
        'html': 'html',
        'php4': 'php',
        'php5': 'php',
        'xls': 'xls',
        'xhtml': 'html',
        'php7': 'php',
        'css': 'css',
        'php3': 'php',
        '3gp': 'music',
        'ppt': 'ppt',
        'mov': 'film',
        'perl': 'script',
        'jsp': 'code',
        'sql': 'db',
        'php': 'php',
        'm4v': 'film',
        'a': 'zip',
        'svg': 'picture',
        'sh': 'script',
        'so': 'linux',
        'cpp': 'code'
    };
    if (ext in file_browse_extensions) {
        return window.filebrowse_img_root.concat('/').concat(file_browse_extensions[ext]).concat('.png');
    }
    return window.filebrowse_img_root.concat('/file.png');
}
