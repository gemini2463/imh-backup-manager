/**
 * IMH Backup Manager - Frontend JavaScript
 *
 * Communicates with the existing Python/Flask CGI backend (backups.cgi)
 * for all data operations. The PHP page provides the UI structure;
 * this script handles all interactivity and data flow.
 *
 * Version: 0.1.0
 */

(function () {
    'use strict';

    var CGI_URL = window.BM_CONFIG ? window.BM_CONFIG.cgiUrl : './backups.cgi';

    // State
    var state = {
        saltManaged: false,
        svrClass: '',
        cores: 1,
        isShared: false,
        countdownTimer: null,
        ticketsSubmitted: [],
        resetTab: null,
        // Parsed data from initial GET
        initialDoc: null,
        remoteIp: '',
        fileBrowserLoaded: false,
        fbSelectedPaths: []
    };

    // ==========================================
    // Utility Functions
    // ==========================================

    function $(sel, ctx) { return (ctx || document).querySelector(sel); }
    function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
    function show(el) { if (el) el.classList.remove('bm-hidden'); }
    function hide(el) { if (el) el.classList.add('bm-hidden'); }
    function isHidden(el) { return el && el.classList.contains('bm-hidden'); }

    function showAlert(id, msg, success) {
        var el = typeof id === 'string' ? $('#' + id) : id;
        if (!el) return;
        el.className = 'bm-alert bm-alert-visible ' + (success ? 'bm-alert-success' : 'bm-alert-danger');
        el.textContent = msg;
        if (success) {
            setTimeout(function () {
                if (el.classList.contains('bm-alert-success')) {
                    el.classList.remove('bm-alert-visible');
                }
            }, 3000);
        }
    }

    function hideAlert(id) {
        var el = typeof id === 'string' ? $('#' + id) : id;
        if (el) el.classList.remove('bm-alert-visible');
    }

    function doPost(action, args, button, alertId, onsuccess) {
        if (button) button.disabled = true;
        var formData = new FormData();
        formData.append('action', action);
        formData.append('args', JSON.stringify(args));

        fetch(CGI_URL, {
            method: 'POST',
            body: formData
        })
        .then(function (resp) {
            if (!resp.ok) return resp.text().then(function (t) { throw new Error(t); });
            return resp.text();
        })
        .then(function (data) {
            if (button) button.disabled = false;
            if (alertId) showAlert(alertId, data, true);
            if (onsuccess) onsuccess(data);
        })
        .catch(function (err) {
            if (button) button.disabled = false;
            if (alertId) showAlert(alertId, err.message || 'Error', false);
            console.error(action, err);
        });
    }

    // ==========================================
    // Tab Navigation
    // ==========================================

    function initTabs() {
        $$('#bm-tabs-nav button').forEach(function (btn) {
            btn.addEventListener('click', function () {
                $$('#bm-tabs-nav button').forEach(function (b) { b.classList.remove('bm-active'); });
                $$('.bm-tab-content').forEach(function (t) { t.classList.remove('bm-active'); });
                btn.classList.add('bm-active');
                var tab = $('#' + btn.getAttribute('data-tab'));
                if (tab) tab.classList.add('bm-active');
                // Lazy-load actions on tab switch
                if (btn.getAttribute('data-tab') === 'bm-tab-status') {
                    BM.refreshStatus();
                }
                if (btn.getAttribute('data-tab') === 'bm-tab-restore' && !state.fileBrowserLoaded) {
                    initFileBrowser();
                }
            });
        });
    }

    // ==========================================
    // Initial Data Loading
    // ==========================================

    function loadInitialData() {
        // Fetch the existing CGI GET response and parse it to extract form values
        fetch(CGI_URL, { method: 'GET', credentials: 'same-origin' })
        .then(function (resp) {
            if (!resp.ok) throw new Error('Failed to load backend: ' + resp.status);
            return resp.text();
        })
        .then(function (html) {
            var parser = new DOMParser();
            state.initialDoc = parser.parseFromString(html, 'text/html');
            populateFromBackend(state.initialDoc);
        })
        .catch(function (err) {
            console.error('Failed to load initial data:', err);
            var downAlert = $('#bm-down-alert');
            if (downAlert) {
                downAlert.textContent = 'Error loading backup configuration: ' + err.message;
                downAlert.classList.add('bm-alert-visible');
            }
        });

        // Also load restore queue and status via POST actions
        updateRestoreQueue();
    }

    function populateFromBackend(doc) {
        // Extract server class and managed state
        var svrDiv = $('#svr-class', doc);
        if (svrDiv) {
            state.svrClass = svrDiv.getAttribute('data-svr-class') || '';
            state.saltManaged = svrDiv.getAttribute('data-salt-managed') === 'true';
        }

        // Extract remote IP
        var scripts = $$('script', doc);
        scripts.forEach(function (s) {
            var m = s.textContent.match(/window\.remote_ip\s*=\s*'([^']+)'/);
            if (m) state.remoteIp = m[1];
        });

        // Down error
        var downAlertSrc = $('#alert-down', doc);
        if (downAlertSrc && downAlertSrc.textContent.trim()) {
            var downAlert = $('#bm-down-alert');
            downAlert.innerHTML = downAlertSrc.innerHTML;
            downAlert.classList.add('bm-alert-visible');
            hide($('#bm-restore-forms'));
        }

        // Total usage banner
        var totalEl = $('#total-usage', doc);
        if (totalEl) {
            $('#bm-usage-text').textContent = totalEl.textContent.replace(/Purchase Backup Space/g, '').trim();
        }

        // --- Settings Tab ---
        populateSettings(doc);

        // --- Sizes Tab ---
        populateSizes(doc);

        // --- Tuning Tab ---
        populateTuning(doc);

        // --- Restore Tab ---
        populateRestoreDates(doc);

        // Apply salt_managed disable state
        if (state.saltManaged) {
            disableManagedFields();
        }
    }

    // ==========================================
    // Populate Settings Tab
    // ==========================================

    function populateSettings(doc) {
        // Dirs
        setToggle('dirs-enabled', isChecked('#dirs-enabled', doc));
        populateSchedule('dirs', doc);
        populateTags('dirs-paths', doc);
        populateTagsExclude('dirs-exclude', doc);

        // MySQL
        setToggle('mysql-enabled', isChecked('#mysql-enabled', doc));
        populateSchedule('mysql', doc);
        populateDbMode('mysql', doc);
        setToggle('mysql-cpuser-enabled', isChecked('#mysql-cpuser-enabled', doc));

        // PgSQL
        setToggle('pgsql-enabled', isChecked('#pgsql-enabled', doc));
        populateSchedule('pgsql', doc);
        populateDbMode('pgsql', doc);
        setToggle('pgsql-cpuser-enabled', isChecked('#pgsql-cpuser-enabled', doc));

        // Trigger visibility
        BM.enableChanged('dirs');
        BM.enableChanged('mysql');
        BM.enableChanged('pgsql');
    }

    function isChecked(sel, doc) {
        var el = $(sel, doc);
        return el ? el.checked || el.hasAttribute('checked') : false;
    }

    function setToggle(id, checked) {
        var el = $('#' + id);
        if (el) el.checked = checked;
    }

    function populateSchedule(type, doc) {
        // Determine if interval or daily
        var intervalRadio = $('input[name="' + type + '-sched"][value="interval"]', doc);
        var useInterval = intervalRadio && (intervalRadio.checked || intervalRadio.hasAttribute('checked'));
        var radio = $('input[name="' + type + '-sched"][value="' + (useInterval ? 'interval' : 'daily') + '"]');
        if (radio) radio.checked = true;

        // Interval value
        var intervalInput = $('#' + type + '-interval', doc);
        if (intervalInput) {
            var ourInput = $('#' + type + '-interval');
            if (ourInput) ourInput.value = intervalInput.value;
        }

        // Hour & meridiem
        var hourSel = $('#' + type + '-hour', doc);
        if (hourSel) {
            var ourHour = $('#' + type + '-hour');
            if (ourHour) ourHour.value = hourSel.value;
        }
        var merSel = $('#' + type + '-meridiem', doc);
        if (merSel) {
            var ourMer = $('#' + type + '-meridiem');
            if (ourMer) ourMer.value = merSel.value;
        }

        // Days checkboxes
        var srcDays = $$('#' + type + '-sched-daily input[type="checkbox"], .' + type + '-day-checkbox', doc);
        srcDays.forEach(function (cb) {
            if (cb.checked || cb.hasAttribute('checked')) {
                var val = cb.value;
                var target = $('#' + type + '-days input[value="' + val + '"]');
                if (target) target.checked = true;
            }
        });

        BM.schedChanged(type);
    }

    function populateTags(containerId, doc) {
        // Extract tag-it items from the source doc
        var srcUl = $('#' + containerId, doc);
        if (!srcUl) return;
        var sizesAttr = srcUl.getAttribute('data-sizes');
        var sizes = {};
        try { sizes = JSON.parse(sizesAttr || '{}'); } catch (e) {}

        var container = $('#' + containerId);
        if (container) container.setAttribute('data-sizes', JSON.stringify(sizes));

        var items = $$('li', srcUl);
        items.forEach(function (li) {
            var path = li.textContent.trim();
            // Remove any tag-it UI artifacts
            path = path.replace(/\s*×?\s*$/, '').replace(/\([^)]*\)\s*$/, '').trim();
            if (path && path.startsWith('/')) {
                var sizeLabel = sizes[path] || '';
                addTag(containerId, path, sizeLabel);
            }
        });
    }

    function populateTagsExclude(containerId, doc) {
        var srcUl = $('#' + containerId, doc);
        if (!srcUl) return;
        var items = $$('li', srcUl);
        items.forEach(function (li) {
            var path = li.textContent.trim().replace(/\s*×?\s*$/, '').trim();
            if (path && path.startsWith('/')) {
                addTag(containerId, path, '');
            }
        });
    }

    function populateDbMode(type, doc) {
        var modeRadio = $('input[name="' + type + '-mode"]:checked', doc);
        if (!modeRadio) {
            // Try finding checked attribute
            var radios = $$('input[name="' + type + '-mode"]', doc);
            radios.forEach(function (r) { if (r.hasAttribute('checked')) modeRadio = r; });
        }
        var mode = modeRadio ? modeRadio.value : 'all';
        var ourRadio = $('input[name="' + type + '-mode"][value="' + mode + '"]');
        if (ourRadio) ourRadio.checked = true;

        // Populate whitelist and blacklist DB lists
        ['whitelist', 'blacklist'].forEach(function (listType) {
            var srcDiv = $('#' + type + '-mode-' + listType, doc);
            var targetDiv = $('#' + type + '-mode-' + listType);
            if (!srcDiv || !targetDiv) return;
            targetDiv.innerHTML = '';
            var checkboxes = $$('input[type="checkbox"]', srcDiv);
            checkboxes.forEach(function (cb) {
                var label = document.createElement('label');
                var input = document.createElement('input');
                input.type = 'checkbox';
                input.value = cb.value;
                if (cb.checked || cb.hasAttribute('checked')) input.checked = true;
                label.appendChild(input);
                var sizeMb = cb.getAttribute('data-size') || '0';
                var sizeGb = (parseFloat(sizeMb) / 1024).toFixed(2);
                label.appendChild(document.createTextNode(' ' + cb.value + ' (' + sizeGb + ' GB)'));
                targetDiv.appendChild(label);
            });
        });

        BM.dbModeChanged(type);
    }

    // ==========================================
    // Populate Sizes Tab
    // ==========================================

    function populateSizes(doc) {
        // System sizes - parse from the rendered HTML
        var sizeRows = $$('.size-breakdown-row', doc);
        var sizeMap = {};
        sizeRows.forEach(function (row) {
            var cols = $$('.col-sm-3, .col-sm-1', row);
            if (cols.length >= 2) {
                var label = cols[0].textContent.trim().toLowerCase();
                var value = cols[1].textContent.trim();
                sizeMap[label] = value;
            }
        });

        // Map extracted values
        var mappings = {
            'system directories': 'bm-size-dirs',
            'system mysql databases': 'bm-size-mysql',
            'system pgsql databases': 'bm-size-pgsql',
            'system grace': 'bm-size-grace',
            'system total': 'bm-size-sys-total'
        };
        Object.keys(mappings).forEach(function (key) {
            var el = $('#' + mappings[key]);
            if (el && sizeMap[key]) el.textContent = sizeMap[key];
        });

        // cPanel user sizes
        var cpuserRows = $$('.cpuser-row', doc);
        var container = $('#bm-cpuser-rows');
        if (container && cpuserRows.length > 0) {
            container.innerHTML = '';
            cpuserRows.forEach(function (row) {
                var user = row.getAttribute('data-user');
                var size = row.getAttribute('data-size');
                var limitInput = $('input[type="number"]', row);
                var limit = limitInput ? limitInput.value : '0';
                var notifyInput = $('input[type="checkbox"]', $$('.cpuser-notify-switch', row)[0] || row);
                var notify = notifyInput ? (notifyInput.checked || notifyInput.hasAttribute('checked')) : false;

                var div = document.createElement('div');
                div.className = 'bm-size-row';
                div.setAttribute('data-user', user);
                div.setAttribute('data-size', size);
                div.innerHTML =
                    '<div style="flex:0 0 200px;">' + escHtml(user) + '</div>' +
                    '<div style="flex:0 0 100px;text-align:right;">' + escHtml(size === '?' ? '??' : size) + ' GiB</div>' +
                    '<div style="flex:0 0 120px;"><div class="bm-progress bm-hidden cpuser-limit-el"><div class="bm-progress-bar" style="width:0%"></div></div></div>' +
                    '<div style="flex:0 0 120px;text-align:center;" class="bm-hidden cpuser-limit-el"><input type="number" class="bm-input bm-input-num cpuser-limit-input" value="' + escHtml(limit) + '" min="0" step="0.1"> GiB</div>' +
                    '<div style="flex:0 0 100px;text-align:center;" class="bm-hidden cpuser-limit-el"><label class="bm-toggle"><input type="checkbox" class="cpuser-notify-cb"' + (notify ? ' checked' : '') + '><span class="bm-toggle-track"><span class="bm-toggle-thumb"></span></span></label></div>';
                container.appendChild(div);
            });
        }

        // cPanel total
        var cpuserTotal = 0;
        cpuserRows.forEach(function (row) {
            var s = row.getAttribute('data-size');
            if (s && s !== '?') cpuserTotal += parseFloat(s);
        });
        var totalEl = $('#bm-cpuser-total');
        if (totalEl) totalEl.innerHTML = '<strong>' + cpuserTotal.toFixed(2) + ' GiB</strong>';

        // Limits state
        var limitToggle = $('#limit-cpusers', doc);
        setToggle('limit-cpusers', isChecked('#limit-cpusers', doc));

        var defaultLimit = $('#cpuser-limit-default', doc);
        if (defaultLimit) {
            var ourDefault = $('#cpuser-limit-default');
            if (ourDefault) ourDefault.value = defaultLimit.value;
        }

        var limitEmail = $('#cpuser-limit-email', doc);
        if (limitEmail) {
            var ourEmail = $('#cpuser-limit-email');
            if (ourEmail) ourEmail.value = limitEmail.value;
        }

        BM.enableChanged('cpuser-limits');

        // Extra users
        var extraUl = $('#extra-user-ul', doc);
        if (extraUl) {
            var extras = $$('li', extraUl);
            if (extras.length > 0) {
                show($('#bm-extra-users-section'));
                var list = $('#bm-extra-users-list');
                list.innerHTML = '';
                extras.forEach(function (li) {
                    var item = document.createElement('li');
                    item.textContent = li.textContent.trim();
                    list.appendChild(item);
                });
            }
        }
    }

    // ==========================================
    // Populate Tuning Tab
    // ==========================================

    function populateTuning(doc) {
        // Detect cores from the source
        var coresEl = $$('[data-cores]', doc);
        if (coresEl.length > 0) {
            state.cores = parseInt(coresEl[0].getAttribute('data-cores')) || 1;
        }

        // Is VPS?
        var isVps = state.svrClass === 'imh_vps';
        state.isShared = $$('.col-md-6', doc).length > 0; // shared servers have split columns

        if (!isVps) {
            show($('#bm-cache-calc-section'));
        }
        if (state.isShared) {
            show($('#bm-restore-load-section'));
        }

        // Helper to extract tuning values
        function extractTuningVal(id) {
            var el = $('#' + id, doc);
            return el ? el.value : null;
        }

        function extractTuningCheck(id) {
            return isChecked('#' + id + '-checkbox', doc);
        }

        function setTuning(id, val) {
            var el = $('#' + id);
            if (el && val !== null) el.value = val;
        }

        function setTuningCheck(id, checked) {
            var el = $('#' + id + '-checkbox');
            if (el) el.checked = checked;
        }

        // Backup load
        var sections = ['backup', 'restore', 'cache-calculation'];
        sections.forEach(function (prefix) {
            // Peak hours
            var peakSel = $('#' + prefix + '-peak-hours', doc);
            if (peakSel) {
                var ourSel = $('#' + prefix + '-peak-hours');
                if (ourSel) {
                    $$('option', peakSel).forEach(function (opt) {
                        if (opt.selected || opt.hasAttribute('selected')) {
                            var ourOpt = $('option[value="' + opt.value + '"]', ourSel);
                            if (ourOpt) ourOpt.selected = true;
                        }
                    });
                }
            }

            // Load values
            setTuning(prefix + '-peak-load-input', extractTuningVal(prefix + '-peak-load-input'));
            setTuning(prefix + '-off-load-input', extractTuningVal(prefix + '-off-load-input'));
            setTuning(prefix + '-sleep-secs', extractTuningVal(prefix + '-sleep-secs'));
            setTuning(prefix + '-run-secs', extractTuningVal(prefix + '-run-secs'));
            setTuningCheck(prefix + '-peak-load', extractTuningCheck(prefix + '-peak-load'));
            setTuningCheck(prefix + '-off-load', extractTuningCheck(prefix + '-off-load'));

            // Parallel
            setTuning(prefix + '-parallel-input', extractTuningVal(prefix + '-parallel-input'));
            setTuningCheck(prefix + '-parallel', extractTuningCheck(prefix + '-parallel'));
        });

        // Standalone settings
        setTuning('bwlimit', extractTuningVal('bwlimit'));
        setTuning('max_cpus', extractTuningVal('max_cpus'));
        setTuning('restic-tmp', extractTuningVal('restic-tmp'));
        setTuning('plugin-du-timeout', extractTuningVal('plugin-du-timeout'));

        // Loglevel
        var logRadio = $('input[name="loglevel"]:checked', doc);
        if (!logRadio) {
            $$('input[name="loglevel"]', doc).forEach(function (r) {
                if (r.hasAttribute('checked')) logRadio = r;
            });
        }
        if (logRadio) {
            var ourLog = $('input[name="loglevel"][value="' + logRadio.value + '"]');
            if (ourLog) ourLog.checked = true;
        }

        multChange();
    }

    // ==========================================
    // Populate Restore Dates
    // ==========================================

    function populateRestoreDates(doc) {
        // Dirs
        var dirsSel = $('#dirs-date', doc);
        populateDateSelect('dirs-date', dirsSel, true);

        // MySQL
        var mysqlSel = $('#mysql-date', doc);
        populateDateSelect('mysql-date', mysqlSel, false);

        // PgSQL
        var pgsqlSel = $('#pgsql-date', doc);
        populateDateSelect('pgsql-date', pgsqlSel, false);

        // Show/hide based on data availability
        ['dirs', 'mysql', 'pgsql'].forEach(function (type) {
            var sel = $('#' + type + '-date');
            if (!sel || sel.options.length === 0) {
                show($('#' + type + '-restore-nodata'));
                hide($('#' + type + '-restore-form'));
            } else {
                hide($('#' + type + '-restore-nodata'));
                show($('#' + type + '-restore-form'));
            }
        });

        // Trigger DB date change to populate dbname selects
        BM.dbDateChanged('mysql');
        BM.dbDateChanged('pgsql');
    }

    function populateDateSelect(targetId, srcSelect, isDirs) {
        var target = $('#' + targetId);
        if (!target || !srcSelect) return;
        target.innerHTML = '';
        $$('option', srcSelect).forEach(function (opt) {
            var newOpt = document.createElement('option');
            newOpt.value = opt.value;
            newOpt.textContent = opt.textContent.trim();
            if (isDirs) {
                newOpt.setAttribute('data-snap', opt.getAttribute('data-snap') || '');
                newOpt.setAttribute('data-geo', opt.getAttribute('data-geo') || '0');
            } else {
                newOpt.setAttribute('data-dbs', opt.getAttribute('data-dbs') || '{}');
            }
            newOpt.setAttribute('data-stamp', opt.getAttribute('data-stamp') || '');
            if (opt.selected || opt.hasAttribute('selected')) newOpt.selected = true;
            target.appendChild(newOpt);
        });
    }

    // ==========================================
    // Tag Input System
    // ==========================================

    function addTag(containerId, text, sizeLabel) {
        var container = $('#' + containerId);
        if (!container) return;
        var field = $('input.bm-tag-field', container);

        var tag = document.createElement('span');
        tag.className = 'bm-tag';
        tag.setAttribute('data-value', text);
        tag.textContent = text;
        if (sizeLabel) {
            var sizeSpan = document.createElement('span');
            sizeSpan.className = 'bm-tag-size';
            sizeSpan.textContent = ' ' + sizeLabel;
            tag.appendChild(sizeSpan);
        }
        var remove = document.createElement('span');
        remove.className = 'bm-tag-remove';
        remove.textContent = '×';
        remove.onclick = function () { tag.remove(); };
        tag.appendChild(remove);
        container.insertBefore(tag, field);
    }

    function getTags(containerId) {
        return $$('.bm-tag', $('#' + containerId)).map(function (tag) {
            return tag.getAttribute('data-value');
        });
    }

    // ==========================================
    // File Browser
    // ==========================================

    function initFileBrowser() {
        var sel = $('#dirs-date');
        if (!sel || sel.options.length === 0) return;
        var opt = sel.options[sel.selectedIndex];
        var snap = opt ? opt.getAttribute('data-snap') : '';
        var geo = opt ? parseInt(opt.getAttribute('data-geo') || '0') : 0;
        loadFileBrowser(snap, geo);
    }

    function loadFileBrowser(snap, geo) {
        if (!snap) return;
        state.fileBrowserLoaded = true;
        var container = $('#restore-filebrowser');
        container.innerHTML = '<div class="bm-fb-loading"><span class="bm-spinner"></span> Loading...</div>';

        doPost('browse', { snap: snap, path: '/', geo: geo }, null, null, function (data) {
            try {
                var result = JSON.parse(data);
                if (result.status === 0) {
                    container.innerHTML = '';
                    renderFbNodes(container, result.data, snap, geo);
                } else {
                    container.innerHTML = '<div class="bm-fb-loading">Error loading files</div>';
                }
            } catch (e) {
                container.innerHTML = '<div class="bm-fb-loading">Error: ' + escHtml(e.message) + '</div>';
            }
        });
    }

    function renderFbNodes(parent, items, snap, geo) {
        items.forEach(function (item) {
            var div = document.createElement('div');
            div.className = 'bm-fb-item';
            var isDir = item.type === 'dir';

            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.setAttribute('data-path', item.path || item.name);
            checkbox.style.marginRight = '6px';
            checkbox.onchange = function () { updateFbCount(); };
            div.appendChild(checkbox);

            if (isDir) {
                var toggle = document.createElement('span');
                toggle.className = 'bm-fb-icon bm-fb-folder';
                toggle.textContent = '📁';
                toggle.style.cursor = 'pointer';
                div.appendChild(toggle);

                var nameSpan = document.createElement('span');
                nameSpan.className = 'bm-fb-folder';
                nameSpan.textContent = item.name || item.path;
                div.appendChild(nameSpan);

                var children = document.createElement('div');
                children.className = 'bm-fb-children bm-hidden';
                children.setAttribute('data-loaded', 'false');
                children.setAttribute('data-path', item.path || item.name);

                var expandHandler = function () {
                    if (isHidden(children)) {
                        show(children);
                        toggle.textContent = '📂';
                        if (children.getAttribute('data-loaded') === 'false') {
                            children.setAttribute('data-loaded', 'true');
                            children.innerHTML = '<div class="bm-fb-loading"><span class="bm-spinner"></span></div>';
                            doPost('browse', { snap: snap, path: children.getAttribute('data-path'), geo: geo }, null, null, function (data) {
                                try {
                                    var r = JSON.parse(data);
                                    if (r.status === 0) {
                                        children.innerHTML = '';
                                        renderFbNodes(children, r.data, snap, geo);
                                    }
                                } catch (e) {
                                    children.innerHTML = '<em>Error</em>';
                                }
                            });
                        }
                    } else {
                        hide(children);
                        toggle.textContent = '📁';
                    }
                };
                toggle.onclick = expandHandler;
                nameSpan.onclick = expandHandler;

                div.appendChild(children);
            } else {
                var icon = document.createElement('span');
                icon.className = 'bm-fb-icon';
                icon.textContent = '📄';
                div.appendChild(icon);
                div.appendChild(document.createTextNode(item.name || item.path));
            }
            parent.appendChild(div);
        });
    }

    function updateFbCount() {
        var count = $$('#restore-filebrowser input[type="checkbox"]:checked').length;
        var el = $('#bm-fb-count');
        if (el) el.textContent = count;
    }

    function getSelectedPaths() {
        return $$('#restore-filebrowser input[type="checkbox"]:checked').map(function (cb) {
            return cb.getAttribute('data-path');
        });
    }

    // ==========================================
    // Restore Queue
    // ==========================================

    function updateRestoreQueue() {
        doPost('get_restore_queue', { prev_tags_loaded: [] }, null, null, function (html) {
            var container = $('#bm-restorations-div');
            if (container) {
                container.innerHTML = html;
                // Check if timer should run
                var doTimerEl = container.querySelector('#do-timer');
                if (doTimerEl) {
                    var doTimer = doTimerEl.getAttribute('data-do-timer') === 'true';
                    resetTimer(doTimer);
                }
            }
        });
    }

    function resetTimer(doTimer) {
        var refreshLine = $('#bm-refreshing');
        var timerSpan = $('#bm-timer');
        if (timerSpan) timerSpan.textContent = '15';
        if (doTimer) {
            if (refreshLine) refreshLine.style.display = '';
            if (!state.countdownTimer) {
                state.countdownTimer = setInterval(updateCountdown, 1000);
            }
        } else {
            if (refreshLine) refreshLine.style.display = 'none';
            if (state.countdownTimer) {
                clearInterval(state.countdownTimer);
                state.countdownTimer = null;
            }
        }
    }

    function updateCountdown() {
        var span = $('#bm-timer');
        if (!span) return;
        var num = parseInt(span.textContent);
        if (num > 1) {
            span.textContent = num - 1;
        } else {
            span.textContent = '0';
            clearInterval(state.countdownTimer);
            state.countdownTimer = null;
            updateRestoreQueue();
        }
    }

    // ==========================================
    // Form Value Collectors
    // ==========================================

    function getSched(type) {
        var useInterval = $('input[name="' + type + '-sched"][value="interval"]');
        var sched = { use_interval: useInterval ? useInterval.checked : false };
        if (sched.use_interval) {
            sched.interval = parseInt($('#' + type + '-interval').value) || 1;
        } else {
            sched.hour = parseInt($('#' + type + '-hour').value) || 12;
            sched.meridiem = $('#' + type + '-meridiem').value || 'AM';
            sched.days = [];
            $$('#' + type + '-days input[type="checkbox"]:checked').forEach(function (cb) {
                sched.days.push(parseInt(cb.value));
            });
        }
        return sched;
    }

    function getSettingsDirs(alertId) {
        var enable = $('#dirs-enabled').checked;
        if (!enable) return { enable: false };
        var params = {
            enable: true,
            paths: getTags('dirs-paths'),
            exclude: getTags('dirs-exclude')
        };
        Object.assign(params, getSched('dirs'));
        if (params.paths.length === 0) {
            showAlert(alertId, 'No paths selected for system directories', false);
            return null;
        }
        if (!params.use_interval && params.days.length === 0) {
            showAlert(alertId, 'No days selected for system directories', false);
            return null;
        }
        return params;
    }

    function getSettingsDb(type, alertId) {
        var enable = $('#' + type + '-enabled').checked;
        var cpuserEnabled = $('#' + type + '-cpuser-enabled').checked;
        if (!enable) return { enable: false, cpuser_enabled: cpuserEnabled };
        var sched = getSched(type);
        if (!sched.use_interval && sched.days.length === 0) {
            showAlert(alertId, 'No days selected for ' + type, false);
            return null;
        }
        var mode = $('input[name="' + type + '-mode"]:checked');
        mode = mode ? mode.value : 'all';
        var custom = null;
        if (mode === 'whitelist' || mode === 'blacklist') {
            custom = [];
            $$('#' + type + '-mode-' + mode + ' input[type="checkbox"]:checked').forEach(function (cb) {
                custom.push(cb.value);
            });
            if (custom.length === 0) {
                showAlert(alertId, 'No databases selected for ' + type, false);
                return null;
            }
        }
        var params = { enable: true, custom: custom, mode: mode, cpuser_enabled: cpuserEnabled };
        Object.assign(params, sched);
        return params;
    }

    function getLoadSettings(prefix) {
        var sel = $('#' + prefix + '-peak-hours');
        var peakHours = [];
        if (sel) {
            $$('option:checked', sel).forEach(function (o) { peakHours.push(parseInt(o.value)); });
        }
        var settings = {
            peak_hours: peakHours,
            off_load: parseFloat($('#' + prefix + '-off-load-input').value) || 0,
            peak_load: parseFloat($('#' + prefix + '-peak-load-input').value) || 0,
            sleep_secs: parseInt($('#' + prefix + '-sleep-secs').value) || 0,
            run_secs: parseInt($('#' + prefix + '-run-secs').value) || 0
        };
        var offCheck = $('#' + prefix + '-off-load-checkbox');
        var peakCheck = $('#' + prefix + '-peak-load-checkbox');
        if (offCheck) settings.off_mult = offCheck.checked;
        if (peakCheck) settings.peak_mult = peakCheck.checked;
        return settings;
    }

    function getParallelSettings(prefix) {
        var input = $('#' + prefix + '-parallel-input');
        var check = $('#' + prefix + '-parallel-checkbox');
        if (!input) return {};
        return { val: parseInt(input.value) || 1, mult: check ? check.checked : false };
    }

    // ==========================================
    // Multiplier updates
    // ==========================================

    function multChange() {
        ['backup-peak-load', 'backup-off-load', 'backup-parallel',
         'restore-peak-load', 'restore-off-load', 'restore-parallel',
         'cache-calculation-peak-load', 'cache-calculation-off-load', 'cache-calculation-parallel'].forEach(function (prefix) {
            var input = $('#' + prefix + '-input');
            var check = $('#' + prefix + '-checkbox');
            var total = $('#' + prefix + '-total');
            if (!input || !total) return;
            var val = parseFloat(input.value) || 0;
            if (check && check.checked) val *= state.cores;
            total.textContent = Math.round(val * 1000) / 1000;
        });
    }

    // ==========================================
    // Utility
    // ==========================================

    function escHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getEmailVal(id) {
        var input = $('#' + id);
        if (!input) return '';
        var val = input.value.trim();
        if (!val) return '';
        var regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(val) ? val : '';
    }

    function disableManagedFields() {
        // On salt-managed servers, disable all inputs in settings & tuning
        $$('#bm-tab-settings input, #bm-tab-settings select, #bm-tab-settings button').forEach(function (el) {
            if (!el.classList.contains('bm-btn-warning')) el.disabled = true;
        });
        $$('#bm-tab-tuning input, #bm-tab-tuning select, #bm-tab-tuning button').forEach(function (el) {
            if (!el.classList.contains('bm-btn-warning')) el.disabled = true;
        });
    }

    // ==========================================
    // Public API (window.BM)
    // ==========================================

    window.BM = {
        // Tab visibility toggles
        enableChanged: function (type) {
            var toggle = $('#' + type + (type === 'cpuser-limits' ? '' : '-enabled'));
            if (!toggle && type === 'cpuser-limits') toggle = $('#limit-cpusers');
            if (!toggle) return;
            var show_ = toggle.checked;
            var targets;
            if (type === 'cpuser-limits') {
                targets = $$('.cpuser-limit-el, #cpuser-limits-default-wrap, #cpuser-limits-email-wrap, #cpuser-limits-hdr-limit, #cpuser-limits-hdr-notify');
            } else {
                targets = [$('#' + type + '-options')];
            }
            targets.forEach(function (el) {
                if (!el) return;
                if (show_) show(el); else hide(el);
            });
        },

        // Schedule type toggle
        schedChanged: function (type) {
            var intervalRadio = $('input[name="' + type + '-sched"][value="interval"]');
            var isInterval = intervalRadio ? intervalRadio.checked : false;
            var intDiv = $('#' + type + '-sched-interval');
            var dailyDiv = $('#' + type + '-sched-daily');
            if (isInterval) { show(intDiv); hide(dailyDiv); }
            else { hide(intDiv); show(dailyDiv); }
        },

        // DB mode toggle
        dbModeChanged: function (type) {
            var mode = $('input[name="' + type + '-mode"]:checked');
            mode = mode ? mode.value : 'all';
            var wl = $('#' + type + '-mode-whitelist');
            var bl = $('#' + type + '-mode-blacklist');
            if (mode === 'whitelist') { show(wl); hide(bl); }
            else if (mode === 'blacklist') { hide(wl); show(bl); }
            else { hide(wl); hide(bl); }
        },

        // Tag input handler
        tagKeydown: function (e, containerId) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            var input = e.target;
            var val = input.value.trim();
            if (!val || !val.startsWith('/')) return;
            var container = $('#' + containerId);
            var sizes = {};
            try { sizes = JSON.parse(container.getAttribute('data-sizes') || '{}'); } catch (ex) {}
            addTag(containerId, val, sizes[val] || '');
            input.value = '';
        },

        // Save actions
        saveDirs: function (btn) {
            var params = getSettingsDirs('alert-save-dirs');
            if (!params) return;
            doPost('save_dirs', params, btn, 'alert-save-dirs');
        },

        saveDb: function (type, btn) {
            var params = getSettingsDb(type, 'alert-save-' + type);
            if (!params) return;
            doPost('save_' + type, params, btn, 'alert-save-' + type);
        },

        saveAll: function (btn) {
            var dirs = getSettingsDirs('alert-save-all');
            if (!dirs) return;
            var mysql = getSettingsDb('mysql', 'alert-save-all');
            if (!mysql) return;
            var pgsql = getSettingsDb('pgsql', 'alert-save-all');
            if (!pgsql) return;
            doPost('save_all', { dirs: dirs, mysql: mysql, pgsql: pgsql }, btn, 'alert-save-all');
        },

        saveTuning: function (btn) {
            var params = {
                loglevel: ($('input[name="loglevel"]:checked') || {}).value || 'INFO',
                bwlimit: parseInt($('#bwlimit').value) || 0,
                backups: getLoadSettings('backup'),
                backup_parallel: getParallelSettings('backup'),
                restore_parallel: getParallelSettings('restore'),
                restic_tmp: $('#restic-tmp').value || '/tmp',
                plugin_du_timeout: parseInt($('#plugin-du-timeout').value) || 60,
                max_cpus: parseInt($('#max_cpus').value) || 0
            };
            if ($('#cache-calculation-peak-load-input')) {
                params.pre_cache = getLoadSettings('cache-calculation');
                params.pre_cache_parallel = getParallelSettings('cache-calculation');
            }
            if ($('#restore-peak-load-input') && !isHidden($('#bm-restore-load-section'))) {
                params.restore = getLoadSettings('restore');
            }
            doPost('save_tuning', params, btn, 'alert-save-tuning');
        },

        saveCpuserLimits: function (btn) {
            var params = {
                do_limit: $('#limit-cpusers').checked,
                default_limit: parseFloat($('#cpuser-limit-default').value) || 0,
                email: getEmailVal('cpuser-limit-email'),
                limits: {},
                notify: {}
            };
            $$('#bm-cpuser-rows .bm-size-row').forEach(function (row) {
                var user = row.getAttribute('data-user');
                var limitInput = $('.cpuser-limit-input', row);
                var notifyCb = $('.cpuser-notify-cb', row);
                if (user) {
                    params.limits[user] = parseFloat(limitInput ? limitInput.value : 0);
                    params.notify[user] = notifyCb ? notifyCb.checked : false;
                }
            });
            doPost('set_cpuser_limits', params, btn, 'alert-cpuser-limit-save');
        },

        // Restore actions
        restoreDirs: function (btn) {
            var sel = $('#dirs-date');
            var opt = sel ? sel.options[sel.selectedIndex] : null;
            if (!opt) { showAlert('alert-restore-dirs', 'No date selected', false); return; }
            var paths = getSelectedPaths();
            if (paths.length === 0) { showAlert('alert-restore-dirs', 'No paths selected', false); return; }
            var method = $('input[name="dirs-method"]:checked');
            var mode = method ? method.value : 'target';
            var params = {
                paths: paths,
                date: parseInt(opt.getAttribute('data-stamp')),
                snap_id: opt.getAttribute('data-snap'),
                geo: parseInt(opt.getAttribute('data-geo') || '0'),
                mode: mode,
                email: getEmailVal('dirs-completion-email')
            };
            if (mode === 'target') {
                params.target = $('#dirs-target').value;
                if (!params.target || !params.target.startsWith('/')) {
                    showAlert('alert-restore-dirs', '"Restore to" must be a full path', false);
                    return;
                }
            }
            doPost('restore_dirs', params, btn, 'alert-restore-dirs', function () {
                updateRestoreQueue();
            });
        },

        restoreDb: function (type, btn) {
            var dateSel = $('#' + type + '-date');
            var opt = dateSel ? dateSel.options[dateSel.selectedIndex] : null;
            var dbSel = $('#' + type + '-dbname');
            var dbOpt = dbSel ? dbSel.options[dbSel.selectedIndex] : null;
            if (!opt || !dbOpt) { showAlert('alert-restore-' + type, 'No selection', false); return; }
            var method = $('input[name="' + type + '-method"]:checked');
            var params = {
                snap_id: dbOpt.value,
                dbname: dbOpt.textContent.trim(),
                date: parseInt(opt.getAttribute('data-stamp')),
                geo: parseInt(opt.value.split(':')[0]) || 0,
                target: $('#' + type + '-path').value,
                mode: method ? method.value : 'target',
                email: getEmailVal(type + '-completion-email')
            };
            if (!params.target || !params.target.startsWith('/')) {
                showAlert('alert-restore-' + type, '"Restore to" must be a full path', false);
                return;
            }
            doPost('restore_' + type, params, btn, 'alert-restore-' + type, function () {
                updateRestoreQueue();
            });
        },

        dbDateChanged: function (type) {
            var dateSel = $('#' + type + '-date');
            if (!dateSel || !dateSel.options.length) return;
            var opt = dateSel.options[dateSel.selectedIndex];
            var dbsStr = opt ? opt.getAttribute('data-dbs') : '{}';
            var dbs = {};
            try { dbs = JSON.parse(dbsStr); } catch (e) {}
            var dbSel = $('#' + type + '-dbname');
            if (!dbSel) return;
            dbSel.innerHTML = '';
            Object.keys(dbs).forEach(function (name) {
                var o = document.createElement('option');
                o.value = dbs[name];
                o.textContent = name;
                dbSel.appendChild(o);
            });
        },

        dirsDateChanged: function () {
            var sel = $('#dirs-date');
            if (!sel || !sel.options.length) return;
            var opt = sel.options[sel.selectedIndex];
            var snap = opt.getAttribute('data-snap');
            var geo = parseInt(opt.getAttribute('data-geo') || '0');
            loadFileBrowser(snap, geo);
        },

        // File browser
        fbSelectAll: function (select) {
            $$('#restore-filebrowser input[type="checkbox"]').forEach(function (cb) {
                cb.checked = select;
            });
            updateFbCount();
        },

        // Status tab
        refreshStatus: function () {
            var btn = $('#bm-status-refresh-btn');
            if (btn) btn.disabled = true;
            doPost('get_status', {}, null, null, function (html) {
                var container = $('#bm-status-data');
                if (container) container.innerHTML = html;
                if (btn) btn.disabled = false;
            });
        },

        // Email validation
        validateEmail: function (input) {
            var val = input.value.trim();
            var errorSpan = input.nextElementSibling;
            while (errorSpan && !errorSpan.classList.contains('bm-email-error')) {
                errorSpan = errorSpan.nextElementSibling;
            }
            if (!val) {
                if (errorSpan) errorSpan.classList.remove('bm-visible');
                return;
            }
            var valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
            if (errorSpan) {
                if (valid) errorSpan.classList.remove('bm-visible');
                else errorSpan.classList.add('bm-visible');
            }
        },

        // Restore queue cancel
        cancelRestore: function (tag) {
            doPost('cancel_restore', { tag: tag }, null, 'alert-queue-msg', updateRestoreQueue);
        },

        // Log viewer modal
        viewLog: function (logJson) {
            var body = $('#bm-log-modal-body');
            body.innerHTML = '';
            try {
                var log = typeof logJson === 'string' ? JSON.parse(logJson) : logJson;
                log.forEach(function (entry) {
                    var p = document.createElement('p');
                    var strong = document.createElement('strong');
                    strong.textContent = new Date(entry[0] * 1000).toString();
                    p.appendChild(strong);
                    p.appendChild(document.createTextNode(' ' + entry[1]));
                    body.appendChild(p);
                });
            } catch (e) {
                body.textContent = 'Error displaying log: ' + e.message;
            }
            $('#bm-log-modal').classList.add('bm-active');
        },

        // Ticket
        makeTicket: function () {
            var modal = $('#bm-ticket-modal');
            var params = {
                ipaddr: state.remoteIp,
                task: modal.getAttribute('data-task') || '',
                log: JSON.parse(modal.getAttribute('data-log') || '[]'),
                params: JSON.parse(modal.getAttribute('data-params') || '{}'),
                msg: $('#bm-ticket-body').value
            };
            var btn = $('#bm-ticket-do-btn');
            btn.disabled = true;
            btn.textContent = 'Please wait...';
            doPost('make_ticket', params, btn, 'alert-ticket-error', function () {
                BM.closeModal('bm-ticket-modal');
                $('#bm-ticket-body').value = '';
                btn.textContent = 'Submit Ticket';
            });
        },

        // Reset
        resetModal: function (tab, name) {
            state.resetTab = tab;
            $('#bm-reset-tab-name').textContent = name;
            hideAlert('alert-reset-error');
            show($('#bm-reset-diff-loading'));
            hide($('#bm-reset-diff'));
            var btn = $('#bm-reset-confirm-btn');
            btn.disabled = true;
            btn.textContent = 'Loading...';
            $('#bm-reset-modal').classList.add('bm-active');

            doPost('reset_' + tab, { confirm: false }, null, null, function (html) {
                hide($('#bm-reset-diff-loading'));
                var diff = $('#bm-reset-diff');
                diff.innerHTML = html;
                show(diff);
                btn.disabled = false;
                btn.textContent = 'Reset';
            });
        },

        confirmReset: function () {
            var btn = $('#bm-reset-confirm-btn');
            btn.disabled = true;
            btn.textContent = 'Please wait...';
            doPost('reset_' + state.resetTab, { confirm: true }, null, null, function () {
                showAlert('alert-reset-error', 'Refreshing...', true);
                location.reload(true);
            });
        },

        // Modal control
        closeModal: function (id) {
            var modal = $('#' + id);
            if (modal) modal.classList.remove('bm-active');
        }
    };

    // ==========================================
    // Initialization
    // ==========================================

    document.addEventListener('DOMContentLoaded', function () {
        initTabs();

        // Listen for multiplier changes
        $$('input[type="number"], input[type="checkbox"]').forEach(function (el) {
            var id = el.id || '';
            if (id.match(/(load|parallel)-input$/) || id.match(/(load|parallel)-checkbox$/)) {
                el.addEventListener('change', multChange);
                el.addEventListener('input', multChange);
            }
        });

        // Load data from CGI backend
        loadInitialData();
    });

})();
