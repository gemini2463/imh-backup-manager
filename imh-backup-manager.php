<?php
// Backup Manager
/**
 * IMH Backup Manager - WHM/CWP Plugin
 *
 * PHP frontend for the InMotion Hosting backup system.
 * Communicates with the existing Python/Flask CGI backend for all data operations.
 *
 * Compatible with:
 *   - cPanel/WHM: /usr/local/cpanel/whostmgr/docroot/cgi/imh-backup-manager/index.php
 *   - CWP:        /usr/local/cwpsrv/htdocs/resources/admin/modules/imh-backup-manager.php
 *
 * Maintainer: InMotion Hosting
 * Version: 0.1.0
 */

// ==========================
// 1. Environment Detection
// ==========================

declare(strict_types=1);

$isCPanelServer = (
    (is_dir('/usr/local/cpanel') || is_dir('/var/cpanel') || is_dir('/etc/cpanel'))
    && (is_file('/usr/local/cpanel/cpanel') || is_file('/usr/local/cpanel/version'))
);

$isCWPServer = is_dir('/usr/local/cwp');

if ($isCPanelServer) {
    if (getenv('REMOTE_USER') !== 'root') exit('Access Denied');
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
} elseif ($isCWPServer) {
    if (!isset($_SESSION['logged']) || $_SESSION['logged'] != 1
        || !isset($_SESSION['username']) || $_SESSION['username'] !== 'root') {
        exit('Access Denied');
    }
}

// ==========================
// 2. Configuration
// ==========================

// CGI backend URL (relative path from this plugin's location)
if ($isCPanelServer) {
    // cPanel: the CGI is served at /cgi/backups/cgi/backups.cgi relative to WHM root
    // From our plugin at /cgi/imh-backup-manager/, the relative path is:
    $CGI_BACKEND = '../backups.cgi';
} else {
    // CWP: adjust as needed for the CWP installation
    $CGI_BACKEND = '/backups/cgi/backups.cgi';
}

// ==========================
// 3. HTML Header & CSS
// ==========================

if ($isCPanelServer) {
    require_once('/usr/local/cpanel/php/WHM.php');
    WHM::header('Backup Manager', 0, 0);
} else {
    echo '<div class="panel-body">';
}

?>

<style>
/* ============================================
   IMH Backup Manager - Styles
   Minimal, no Bootstrap dependency
   ============================================ */

/* --- Reset & Base --- */
.bm-wrap { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #333; line-height: 1.5; }
.bm-wrap *, .bm-wrap *::before, .bm-wrap *::after { box-sizing: border-box; }
.bm-wrap a { color: #4ba0e1; text-decoration: none; transition: color .2s; }
.bm-wrap a:hover { color: #2a6fa0; }
.bm-wrap h1, .bm-wrap h2, .bm-wrap h3 { margin: 0 0 0.5em 0; color: #333; }
.bm-wrap h1 { font-size: 1.6em; }
.bm-wrap h2 { font-size: 1.35em; font-weight: 700; }
.bm-wrap h3 { font-size: 1.1em; font-weight: 700; }
.bm-wrap p { margin: 0.5em 0; }
.bm-wrap hr { border: none; border-top: 1px solid #ddd; margin: 1em 0; }
.bm-hidden { display: none !important; }

/* --- Layout --- */
.bm-row { display: flex; flex-wrap: wrap; gap: 1em; }
.bm-row > * { flex: 1 1 auto; }
.bm-col-2 { flex: 0 0 15%; max-width: 15%; }
.bm-col-3 { flex: 0 0 25%; max-width: 25%; }
.bm-col-4 { flex: 0 0 33.33%; max-width: 33.33%; }
.bm-col-6 { flex: 0 0 50%; max-width: 50%; }
.bm-col-8 { flex: 0 0 66.66%; max-width: 66.66%; }
.bm-col-9 { flex: 0 0 75%; max-width: 75%; }
.bm-col-10 { flex: 0 0 83.33%; max-width: 83.33%; }
.bm-col-12 { flex: 0 0 100%; max-width: 100%; }
.bm-text-right { text-align: right; }
.bm-text-center { text-align: center; }
.bm-pad-left { padding-left: 1.5em; }
.bm-nowrap { white-space: nowrap; }
.bm-inline { display: inline; }

/* --- Title --- */
.bm-title { display: flex; align-items: center; gap: 0.5em; margin: 0.25em 0 1em 0; }
.bm-title img { height: 48px; width: auto; }

/* --- Tabs --- */
.bm-tabs-nav { display: flex; border-bottom: 2px solid #ddd; margin-bottom: 0; overflow-x: auto; }
.bm-tabs-nav button {
    background: #f5f5f5; border: 1px solid #ddd; border-bottom: 2px solid transparent;
    padding: 10px 20px; cursor: pointer; font-size: 0.9em; font-weight: 600;
    color: #555; margin-bottom: -2px; transition: all .2s; white-space: nowrap;
    border-top-left-radius: 4px; border-top-right-radius: 4px;
}
.bm-tabs-nav button:hover { background: #fff; color: #333; }
.bm-tabs-nav button.bm-active { background: #fff; color: #2a6fa0; border-bottom-color: #2a6fa0; }
.bm-tab-content { display: none; border: 1px solid #ddd; border-top: none; padding: 1.5em; }
.bm-tab-content.bm-active { display: block; }

/* --- Cards/Wells --- */
.bm-card {
    background: #f9f9f9; border: 1px solid #ddd; border-radius: 6px;
    padding: 1em 1.2em; margin: 1em 0;
}

/* --- Buttons --- */
.bm-btn {
    display: inline-block; padding: 6px 16px; font-size: 0.9em; font-weight: 600;
    border: 1px solid transparent; border-radius: 4px; cursor: pointer;
    transition: all .2s; text-decoration: none; line-height: 1.5;
}
.bm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.bm-btn-primary { background: #418FBF; color: #fff; border-color: #3580ab; }
.bm-btn-primary:hover:not(:disabled) { background: #336f96; }
.bm-btn-success { background: #5cb85c; color: #fff; border-color: #4cae4c; }
.bm-btn-success:hover:not(:disabled) { background: #449d44; }
.bm-btn-warning { background: #f0ad4e; color: #fff; border-color: #eea236; }
.bm-btn-warning:hover:not(:disabled) { background: #ec971f; }
.bm-btn-danger { background: #d9534f; color: #fff; border-color: #d43f3a; }
.bm-btn-danger:hover:not(:disabled) { background: #c9302c; }
.bm-btn-info { background: #5bc0de; color: #fff; border-color: #46b8da; }
.bm-btn-info:hover:not(:disabled) { background: #31b0d5; }
.bm-btn-sm { padding: 3px 8px; font-size: 0.82em; }
.bm-btn-block { display: block; width: 100%; }

/* --- Alerts --- */
.bm-alert {
    padding: 8px 14px; border-radius: 4px; margin: 0.5em 0;
    font-size: 0.9em; display: none;
}
.bm-alert-visible { display: block; }
.bm-alert-inline { display: inline-block; }
.bm-alert-success { background: #dff0d8; color: #3c763d; border: 1px solid #d6e9c6; }
.bm-alert-danger { background: #f2dede; color: #a94442; border: 1px solid #ebccd1; }
.bm-alert-warning { background: #fcf8e3; color: #8a6d3b; border: 1px solid #faebcc; }
.bm-alert-info { background: #d9edf7; color: #31708f; border: 1px solid #bce8f1; }

/* --- Forms --- */
.bm-form-group { margin-bottom: 1em; }
.bm-form-inline { display: flex; align-items: center; gap: 0.5em; flex-wrap: wrap; }
.bm-label { font-weight: 600; display: block; margin-bottom: 0.25em; }
.bm-input, .bm-select {
    padding: 5px 10px; border: 1px solid #ccc; border-radius: 3px;
    font-size: 0.9em; background: #fff; color: #333;
}
.bm-input:focus, .bm-select:focus { border-color: #66afe9; outline: none; box-shadow: 0 0 0 2px rgba(102,175,233,.3); }
.bm-input-num { width: 80px; }
.bm-input-text { width: 300px; max-width: 100%; }
.bm-input-wide { width: 100%; }
.bm-textarea { width: 100%; min-height: 100px; padding: 8px; border: 1px solid #ccc; border-radius: 3px; font-family: inherit; }

/* --- Checkbox & Radio --- */
.bm-check-group label, .bm-radio-group label {
    display: block; padding: 2px 0; cursor: pointer; font-weight: normal;
}
.bm-check-group.bm-inline label, .bm-radio-group.bm-inline label {
    display: inline-block; margin-right: 1em;
}
.bm-check-group input, .bm-radio-group input { margin-right: 0.4em; }

/* --- Toggle Switch --- */
.bm-toggle { position: relative; display: inline-flex; align-items: center; gap: 0.5em; cursor: pointer; }
.bm-toggle input { display: none; }
.bm-toggle-track {
    width: 44px; height: 22px; background: #d9534f; border-radius: 11px;
    transition: background .2s; position: relative;
}
.bm-toggle input:checked + .bm-toggle-track { background: #418FBF; }
.bm-toggle-thumb {
    position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
    background: #fff; border-radius: 50%; transition: left .2s;
}
.bm-toggle input:checked + .bm-toggle-track .bm-toggle-thumb { left: 24px; }
.bm-toggle input:disabled + .bm-toggle-track { opacity: 0.5; cursor: not-allowed; }
.bm-toggle-label { font-weight: 600; }

/* --- Progress Bar --- */
.bm-progress { background: #e8e8e8; border-radius: 3px; height: 20px; overflow: hidden; margin: 4px 0; }
.bm-progress-bar {
    height: 100%; background: green; transition: width .3s, background-color .3s;
    font-size: 0.75em; color: #fff; font-weight: 700; text-align: center; line-height: 20px;
}

/* --- Tag Input --- */
.bm-tag-input { border: 1px solid #ccc; border-radius: 3px; padding: 4px 6px; min-height: 36px; background: #fff; display: flex; flex-wrap: wrap; gap: 4px; cursor: text; }
.bm-tag {
    display: inline-flex; align-items: center; gap: 4px;
    background: #e8f0fe; border: 1px solid #b8d4f0; border-radius: 3px;
    padding: 2px 8px; font-size: 0.85em;
}
.bm-tag-remove { cursor: pointer; color: #888; font-weight: 700; }
.bm-tag-remove:hover { color: #c00; }
.bm-tag-size { color: #666; font-weight: 600; }
.bm-tag-field { border: none; outline: none; flex: 1 1 120px; min-width: 120px; font-size: 0.9em; }

/* --- Custom DB list --- */
.bm-db-list {
    max-height: 150px; overflow-y: auto; border: 1px solid #ddd;
    background: #fcfcfc; padding: 0.5em; margin: 0.5em 0 0.5em 1.5em;
}
.bm-db-list label { display: block; font-weight: normal; padding: 1px 0; }

/* --- File Browser --- */
.bm-filebrowser {
    border: 1px solid #ccc; background: #fff; min-height: 200px;
    max-height: 400px; overflow: auto; padding: 0.5em; margin: 0.5em 0;
    font-family: monospace; font-size: 0.85em;
}
.bm-fb-loading { padding: 1em; color: #888; }
.bm-fb-item { padding: 2px 0; padding-left: 1em; }
.bm-fb-folder { cursor: pointer; }
.bm-fb-folder:hover { background: #f0f0f0; }
.bm-fb-icon { display: inline-block; width: 20px; text-align: center; margin-right: 4px; }
.bm-fb-children { padding-left: 1.5em; }

/* --- Restore Queue --- */
.bm-queue-item {
    background: #fff; border: 1px solid #ddd; border-radius: 4px;
    padding: 0.8em; margin: 0.5em 0;
}
.bm-queue-item.bm-new { animation: bm-flash 2s 1; }
@keyframes bm-flash { 0% { background: #ee6; } 100% { background: #fff; } }
.bm-queue-cols { display: flex; gap: 1em; align-items: flex-start; }
.bm-queue-info { flex: 1; }
.bm-queue-status { flex: 0 0 100px; font-weight: 700; }
.bm-queue-actions { flex: 0 0 auto; display: flex; flex-direction: column; gap: 4px; }
.bm-queue-actions a { white-space: nowrap; }

/* --- Size Breakdown --- */
.bm-size-header { border-bottom: 2px solid #333; padding: 0.5em 0; display: flex; font-weight: 700; }
.bm-size-row { display: flex; padding: 0.7em 0; border-bottom: 1px solid #eee; align-items: center; }
.bm-size-row:nth-child(odd) { background: #fafafa; }
.bm-size-label { flex: 0 0 250px; }
.bm-size-value { flex: 0 0 100px; text-align: right; }

/* --- Modal --- */
.bm-modal-overlay {
    display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5); z-index: 10000; justify-content: center; align-items: center;
}
.bm-modal-overlay.bm-active { display: flex; }
.bm-modal {
    background: #fff; border-radius: 6px; max-width: 600px; width: 90%;
    max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}
.bm-modal-header { padding: 1em 1.2em; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; }
.bm-modal-header h3 { margin: 0; }
.bm-modal-close { cursor: pointer; font-size: 1.5em; color: #888; background: none; border: none; }
.bm-modal-close:hover { color: #333; }
.bm-modal-body { padding: 1em 1.2em; }
.bm-modal-footer { padding: 0.8em 1.2em; border-top: 1px solid #ddd; display: flex; justify-content: flex-end; gap: 0.5em; }

/* --- Status Tab --- */
.bm-status-content code { display: block; padding-left: 1em; color: #555; }
.bm-status-content .well { background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; padding: 1em; margin: 0.5em 0; }

/* --- Loading --- */
.bm-loading { text-align: center; padding: 3em; font-size: 1.2em; color: #888; }
.bm-spinner { display: inline-block; width: 20px; height: 20px; border: 3px solid #ddd; border-top-color: #418FBF; border-radius: 50%; animation: bm-spin 0.8s linear infinite; }
@keyframes bm-spin { to { transform: rotate(360deg); } }

/* --- Info Icon --- */
.bm-help-icon { cursor: help; color: #666; font-size: 1.1em; position: relative; }
.bm-help-icon:hover::after {
    content: attr(data-help); position: absolute; bottom: 120%; left: 50%; transform: translateX(-50%);
    background: #333; color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 0.8em;
    white-space: normal; width: 250px; z-index: 100; font-weight: normal;
}

/* --- Misc --- */
#bm-total-usage { font-weight: 700; font-size: 1.05em; margin: 0.5em 0 1em 0; }
.bm-email-error { color: #a94442; font-size: 0.85em; display: none; }
.bm-email-error.bm-visible { display: inline; }

/* --- Responsive --- */
@media (max-width: 768px) {
    .bm-tabs-nav { flex-wrap: wrap; }
    .bm-tabs-nav button { flex: 1 1 auto; text-align: center; }
    .bm-col-2, .bm-col-3, .bm-col-4, .bm-col-6, .bm-col-8, .bm-col-9, .bm-col-10 { flex: 0 0 100%; max-width: 100%; }
    .bm-size-label { flex: 1; }
}
</style>

<?php

// ==========================
// 4. Main Interface
// ==========================

$img_src = $isCWPServer ? 'design/img/imh-backup-manager.png' : 'imh-backup-manager.png';

?>

<div class="bm-wrap" id="bm-app">

<h1 class="bm-title">
    <img src="<?php echo htmlspecialchars($img_src); ?>" alt="Backup Manager" />
    Backup Manager
</h1>

<!-- Total Usage Banner -->
<div id="bm-total-usage">
    <span id="bm-usage-text">Loading backup usage...</span>
    <a class="bm-btn bm-btn-primary bm-btn-sm" href="https://secure1.inmotionhosting.com/amp/marketplace/backups/" target="_blank">Purchase Backup Space</a>
</div>

<!-- System Down Alert -->
<div id="bm-down-alert" class="bm-alert bm-alert-danger"></div>

<!-- Info Box -->
<div class="bm-alert bm-alert-info bm-alert-visible">
    <p>The Backup Manager feature allows you to utilize InMotion Hosting's automated backup system to retain
    and secure your data off server. From this interface you can view your current backup storage capacity,
    specify which data is backed up and how often, as well as perform data restorations.
    Additional backup storage blocks can be purchased from the AMP Marketplace.</p>
    <p>For additional information, please visit
    <a href="https://www.inmotionhosting.com/support/website/backup-and-restore/backup-manager-whm-vps-dedicated/" target="_blank">our Support Center Articles.</a></p>
</div>

<!-- Tabs Navigation -->
<div class="bm-tabs-nav" id="bm-tabs-nav">
    <button class="bm-active" data-tab="bm-tab-settings">Backup Settings</button>
    <button data-tab="bm-tab-restore">Perform a Restoration</button>
    <button data-tab="bm-tab-sizes">Storage Breakdown</button>
    <button data-tab="bm-tab-status">Queue Status</button>
    <button data-tab="bm-tab-tuning">System Performance Tuning</button>
</div>

<!-- ============================================
     TAB 1: Backup Settings
     ============================================ -->
<div id="bm-tab-settings" class="bm-tab-content bm-active">

<p>This tab is for configuring backups for data not associated to a particular cPanel account, or
disabling backups for a database management system that is not installed.</p>

<!-- System Directories -->
<h2>System Directories</h2>
<div class="bm-card">
    <h3>Scheduling</h3>
    <div class="bm-pad-left">
        <label class="bm-toggle">
            <input type="checkbox" id="dirs-enabled" onchange="BM.enableChanged('dirs')">
            <span class="bm-toggle-track"><span class="bm-toggle-thumb"></span></span>
            <span class="bm-toggle-label">Enable or Disable Backups</span>
        </label>
    </div>
    <div id="dirs-options" class="bm-pad-left">
        <div class="bm-form-group">
            <label>How often do you want your backups performed?</label>
            <div class="bm-radio-group bm-pad-left">
                <label><input type="radio" name="dirs-sched" value="interval" onchange="BM.schedChanged('dirs')"> By Interval</label>
                <div id="dirs-sched-interval" class="bm-pad-left bm-form-group">
                    <span>Backup every </span>
                    <input type="number" class="bm-input bm-input-num" id="dirs-interval" value="1" min="1" max="90">
                    <span> Days</span>
                </div>
                <label><input type="radio" name="dirs-sched" value="daily" onchange="BM.schedChanged('dirs')"> By Day/Time</label>
                <div id="dirs-sched-daily" class="bm-pad-left bm-form-group">
                    <div class="bm-check-group bm-inline" id="dirs-days">
                        <label><input type="checkbox" value="0"> Monday</label>
                        <label><input type="checkbox" value="1"> Tuesday</label>
                        <label><input type="checkbox" value="2"> Wednesday</label>
                        <label><input type="checkbox" value="3"> Thursday</label>
                        <label><input type="checkbox" value="4"> Friday</label>
                        <label><input type="checkbox" value="5"> Saturday</label>
                        <label><input type="checkbox" value="6"> Sunday</label>
                    </div>
                    <div class="bm-form-inline">
                        <span>At:</span>
                        <select class="bm-select" id="dirs-hour">
                            <?php for ($i = 1; $i <= 12; $i++) echo "<option value=\"$i\">$i</option>"; ?>
                        </select>
                        <select class="bm-select" id="dirs-meridiem">
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
        <hr>
        <h3>System Paths</h3>
        <div class="bm-form-group bm-pad-left">
            <label class="bm-label">Paths to backup (provide the full paths and press Enter)</label>
            <p>These are paths to backup for the root account. cPanel users have their /home directories backed up in their individual cPanel dashboards.</p>
            <p><em>Sizes displayed here are from cache and will take some time to reflect any changes.</em></p>
            <div class="bm-tag-input" id="dirs-paths" data-sizes="{}">
                <input type="text" class="bm-tag-field" placeholder="Type a path and press Enter..." onkeydown="BM.tagKeydown(event, 'dirs-paths')">
            </div>
        </div>
        <div class="bm-form-group bm-pad-left">
            <label class="bm-label">Subfolders to skip</label>
            <div class="bm-tag-input" id="dirs-exclude">
                <input type="text" class="bm-tag-field" placeholder="Type a path and press Enter..." onkeydown="BM.tagKeydown(event, 'dirs-exclude')">
            </div>
        </div>
    </div>
    <div style="margin-top:1em;">
        <button class="bm-btn bm-btn-primary" onclick="BM.saveDirs(this)">Save System Directories Settings</button>
        <div id="alert-save-dirs" class="bm-alert"></div>
    </div>
</div>

<!-- MySQL -->
<h2>MySQL</h2>
<div class="bm-card" id="mysql-section">
    <div id="mysql-install-warning" class="bm-alert bm-alert-warning"></div>
    <h3>Scheduling</h3>
    <div class="bm-pad-left">
        <label class="bm-toggle">
            <input type="checkbox" id="mysql-enabled" onchange="BM.enableChanged('mysql')">
            <span class="bm-toggle-track"><span class="bm-toggle-thumb"></span></span>
            <span class="bm-toggle-label">Enable or Disable Backups</span>
        </label>
    </div>
    <div id="mysql-options" class="bm-pad-left">
        <div class="bm-form-group">
            <div class="bm-radio-group bm-pad-left">
                <label><input type="radio" name="mysql-sched" value="interval" onchange="BM.schedChanged('mysql')"> By Interval</label>
                <div id="mysql-sched-interval" class="bm-pad-left bm-form-group">
                    <span>Backup every </span>
                    <input type="number" class="bm-input bm-input-num" id="mysql-interval" value="1" min="1" max="90">
                    <span> Days</span>
                </div>
                <label><input type="radio" name="mysql-sched" value="daily" onchange="BM.schedChanged('mysql')"> By Day/Time</label>
                <div id="mysql-sched-daily" class="bm-pad-left bm-form-group">
                    <div class="bm-check-group bm-inline" id="mysql-days">
                        <label><input type="checkbox" value="0"> Monday</label>
                        <label><input type="checkbox" value="1"> Tuesday</label>
                        <label><input type="checkbox" value="2"> Wednesday</label>
                        <label><input type="checkbox" value="3"> Thursday</label>
                        <label><input type="checkbox" value="4"> Friday</label>
                        <label><input type="checkbox" value="5"> Saturday</label>
                        <label><input type="checkbox" value="6"> Sunday</label>
                    </div>
                    <div class="bm-form-inline">
                        <span>At:</span>
                        <select class="bm-select" id="mysql-hour">
                            <?php for ($i = 1; $i <= 12; $i++) echo "<option value=\"$i\">$i</option>"; ?>
                        </select>
                        <select class="bm-select" id="mysql-meridiem">
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
        <hr>
        <h3>System Tables</h3>
        <div class="bm-form-group bm-pad-left">
            <p>These are tables not associated with a cPanel user (system tables and manually created databases).</p>
            <div class="bm-radio-group bm-pad-left" id="mysql-mode-group">
                <label><input type="radio" name="mysql-mode" value="all" onchange="BM.dbModeChanged('mysql')"> All except cPanel users' databases</label>
                <label><input type="radio" name="mysql-mode" value="whitelist" onchange="BM.dbModeChanged('mysql')"> Backup selected databases only</label>
                <div id="mysql-mode-whitelist" class="bm-db-list bm-hidden"></div>
                <label><input type="radio" name="mysql-mode" value="blacklist" onchange="BM.dbModeChanged('mysql')"> Exclude selected databases</label>
                <div id="mysql-mode-blacklist" class="bm-db-list bm-hidden"></div>
            </div>
        </div>
        <hr>
    </div>
    <h3>All cPanel Users</h3>
    <div class="bm-pad-left">
        <label class="bm-toggle">
            <input type="checkbox" id="mysql-cpuser-enabled">
            <span class="bm-toggle-track"><span class="bm-toggle-thumb"></span></span>
            <span class="bm-toggle-label">Can cPanel users enable MySQL Backups?</span>
        </label>
    </div>
    <div style="margin-top:1em;">
        <button class="bm-btn bm-btn-primary" onclick="BM.saveDb('mysql', this)">Save MySQL Settings</button>
        <div id="alert-save-mysql" class="bm-alert"></div>
    </div>
</div>

<!-- PgSQL -->
<h2>PgSQL</h2>
<div class="bm-card" id="pgsql-section">
    <div id="pgsql-install-warning" class="bm-alert bm-alert-warning"></div>
    <h3>Scheduling</h3>
    <div class="bm-pad-left">
        <label class="bm-toggle">
            <input type="checkbox" id="pgsql-enabled" onchange="BM.enableChanged('pgsql')">
            <span class="bm-toggle-track"><span class="bm-toggle-thumb"></span></span>
            <span class="bm-toggle-label">Enable or Disable Backups</span>
        </label>
    </div>
    <div id="pgsql-options" class="bm-pad-left">
        <div class="bm-form-group">
            <div class="bm-radio-group bm-pad-left">
                <label><input type="radio" name="pgsql-sched" value="interval" onchange="BM.schedChanged('pgsql')"> By Interval</label>
                <div id="pgsql-sched-interval" class="bm-pad-left bm-form-group">
                    <span>Backup every </span>
                    <input type="number" class="bm-input bm-input-num" id="pgsql-interval" value="1" min="1" max="90">
                    <span> Days</span>
                </div>
                <label><input type="radio" name="pgsql-sched" value="daily" onchange="BM.schedChanged('pgsql')"> By Day/Time</label>
                <div id="pgsql-sched-daily" class="bm-pad-left bm-form-group">
                    <div class="bm-check-group bm-inline" id="pgsql-days">
                        <label><input type="checkbox" value="0"> Monday</label>
                        <label><input type="checkbox" value="1"> Tuesday</label>
                        <label><input type="checkbox" value="2"> Wednesday</label>
                        <label><input type="checkbox" value="3"> Thursday</label>
                        <label><input type="checkbox" value="4"> Friday</label>
                        <label><input type="checkbox" value="5"> Saturday</label>
                        <label><input type="checkbox" value="6"> Sunday</label>
                    </div>
                    <div class="bm-form-inline">
                        <span>At:</span>
                        <select class="bm-select" id="pgsql-hour">
                            <?php for ($i = 1; $i <= 12; $i++) echo "<option value=\"$i\">$i</option>"; ?>
                        </select>
                        <select class="bm-select" id="pgsql-meridiem">
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
        <hr>
        <h3>System Tables</h3>
        <div class="bm-form-group bm-pad-left">
            <p>These are tables not associated with a cPanel user (system tables and manually created databases).</p>
            <div class="bm-radio-group bm-pad-left" id="pgsql-mode-group">
                <label><input type="radio" name="pgsql-mode" value="all" onchange="BM.dbModeChanged('pgsql')"> All except cPanel users' databases</label>
                <label><input type="radio" name="pgsql-mode" value="whitelist" onchange="BM.dbModeChanged('pgsql')"> Backup selected databases only</label>
                <div id="pgsql-mode-whitelist" class="bm-db-list bm-hidden"></div>
                <label><input type="radio" name="pgsql-mode" value="blacklist" onchange="BM.dbModeChanged('pgsql')"> Exclude selected databases</label>
                <div id="pgsql-mode-blacklist" class="bm-db-list bm-hidden"></div>
            </div>
        </div>
        <hr>
    </div>
    <h3>All cPanel Users</h3>
    <div class="bm-pad-left">
        <label class="bm-toggle">
            <input type="checkbox" id="pgsql-cpuser-enabled">
            <span class="bm-toggle-track"><span class="bm-toggle-thumb"></span></span>
            <span class="bm-toggle-label">Can cPanel users enable PgSQL Backups?</span>
        </label>
    </div>
    <div style="margin-top:1em;">
        <button class="bm-btn bm-btn-primary" onclick="BM.saveDb('pgsql', this)">Save PgSQL Settings</button>
        <div id="alert-save-pgsql" class="bm-alert"></div>
    </div>
</div>

<!-- Save All -->
<div class="bm-row" style="margin-top:1em;">
    <div class="bm-col-6">
        <button class="bm-btn bm-btn-success" onclick="BM.saveAll(this)">Save All in This Tab</button>
        <div id="alert-save-all" class="bm-alert"></div>
    </div>
    <div class="bm-col-6 bm-text-right">
        <button class="bm-btn bm-btn-warning bm-btn-sm" onclick="BM.resetModal('settings', 'Backup Settings')">Reset All in This Tab</button>
    </div>
</div>

</div><!-- /settings tab -->


<!-- ============================================
     TAB 2: Perform a Restoration
     ============================================ -->
<div id="bm-tab-restore" class="bm-tab-content">

<p>This tab allows restorations of system backups which are not associated to an individual cPanel user.</p>

<div id="alert-timer-error" class="bm-alert"></div>
<div id="alert-queue-msg" class="bm-alert"></div>

<h2>Restorations <small id="bm-refreshing" style="font-size:0.7em;color:#888;">Refreshing in <span id="bm-timer">15</span> seconds</small></h2>
<div id="bm-restorations-div">
    <div class="bm-loading"><span class="bm-spinner"></span> Loading restore queue...</div>
</div>

<div id="bm-restore-forms">
<!-- System Directory Restore -->
<h2>Restore a System Backup</h2>
<div class="bm-card">
    <div id="dirs-restore-nodata" class="bm-hidden">You don't have any system backups to restore from.</div>
    <div id="dirs-restore-form">
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Restore from date</label></div>
            <div class="bm-col-10"><select class="bm-select bm-input-wide" id="dirs-date" onchange="BM.dirsDateChanged()"></select></div>
        </div>
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Select Files</label></div>
            <div class="bm-col-10">
                <div style="margin-bottom:0.5em;">
                    <button class="bm-btn bm-btn-sm bm-btn-info" onclick="BM.fbSelectAll(true)">Select All</button>
                    <button class="bm-btn bm-btn-sm bm-btn-info" onclick="BM.fbSelectAll(false)">Deselect All</button>
                    <div id="alert-restore-browser-error" class="bm-alert bm-alert-danger"></div>
                </div>
                <p>Click folders to expand them. Click checkboxes to select them to be restored.</p>
                <div class="bm-filebrowser" id="restore-filebrowser">
                    <div class="bm-fb-loading"><span class="bm-spinner"></span> Loading file browser...</div>
                </div>
                <p><span id="bm-fb-count">0</span> items selected.</p>
            </div>
        </div>
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Restore Method</label></div>
            <div class="bm-col-10">
                <div class="bm-radio-group">
                    <label><input type="radio" name="dirs-method" value="merge"> Restore to the original path</label>
                    <label><input type="radio" name="dirs-method" value="target" checked>
                        Restore to a different folder
                        <input type="text" class="bm-input bm-input-text" id="dirs-target" value="/root/restored">
                    </label>
                </div>
            </div>
        </div>
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Email (optional)</label></div>
            <div class="bm-col-10">
                <input type="text" class="bm-input bm-input-text" id="dirs-completion-email" placeholder="user@example.com" onkeyup="BM.validateEmail(this)" onchange="BM.validateEmail(this)">
                <span class="bm-email-error" id="dirs-email-error">Invalid Email</span>
            </div>
        </div>
        <div>
            <p><em>Clicking Restore will queue the restoration immediately, and restoring a backup is irreversible.</em></p>
            <button class="bm-btn bm-btn-primary" id="dirs-restore-btn" onclick="BM.restoreDirs(this)">Restore</button>
            <div id="alert-restore-dirs" class="bm-alert"></div>
        </div>
    </div>
</div>

<!-- MySQL Restore -->
<h2>Restore a MySQL Backup</h2>
<div class="bm-card">
    <div id="mysql-restore-nodata" class="bm-hidden">You don't have any MySQL backups to restore from.</div>
    <div id="mysql-restore-form">
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Restore from date</label></div>
            <div class="bm-col-10"><select class="bm-select bm-input-wide" id="mysql-date" onchange="BM.dbDateChanged('mysql')"></select></div>
        </div>
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Select a database</label></div>
            <div class="bm-col-10"><select class="bm-select bm-input-wide" id="mysql-dbname"></select></div>
        </div>
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Dump Path</label></div>
            <div class="bm-col-10"><input type="text" class="bm-input bm-input-text" id="mysql-path" value="/root/restored"></div>
        </div>
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Restore Method</label></div>
            <div class="bm-col-10">
                <div class="bm-radio-group">
                    <label><input type="radio" name="mysql-method" value="target" checked> Dump backup to path above</label>
                    <label><input type="radio" name="mysql-method" value="dump_import"> Dump current database to path and overwrite with backup</label>
                </div>
            </div>
        </div>
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Email (optional)</label></div>
            <div class="bm-col-10">
                <input type="text" class="bm-input bm-input-text" id="mysql-completion-email" placeholder="user@example.com" onkeyup="BM.validateEmail(this)" onchange="BM.validateEmail(this)">
                <span class="bm-email-error">Invalid Email</span>
            </div>
        </div>
        <div>
            <button class="bm-btn bm-btn-primary" onclick="BM.restoreDb('mysql', this)">Restore</button>
            <div id="alert-restore-mysql" class="bm-alert"></div>
        </div>
    </div>
</div>

<!-- PgSQL Restore -->
<h2>Restore a PgSQL Backup</h2>
<div class="bm-card">
    <div id="pgsql-restore-nodata" class="bm-hidden">You don't have any PgSQL backups to restore from.</div>
    <div id="pgsql-restore-form">
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Restore from date</label></div>
            <div class="bm-col-10"><select class="bm-select bm-input-wide" id="pgsql-date" onchange="BM.dbDateChanged('pgsql')"></select></div>
        </div>
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Select a database</label></div>
            <div class="bm-col-10"><select class="bm-select bm-input-wide" id="pgsql-dbname"></select></div>
        </div>
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Dump Path</label></div>
            <div class="bm-col-10"><input type="text" class="bm-input bm-input-text" id="pgsql-path" value="/root/restored"></div>
        </div>
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Restore Method</label></div>
            <div class="bm-col-10">
                <div class="bm-radio-group">
                    <label><input type="radio" name="pgsql-method" value="target" checked> Dump backup to path above</label>
                    <label><input type="radio" name="pgsql-method" value="dump_import"> Dump current database to path and overwrite with backup</label>
                </div>
            </div>
        </div>
        <div class="bm-form-group bm-row">
            <div class="bm-col-2"><label class="bm-label">Email (optional)</label></div>
            <div class="bm-col-10">
                <input type="text" class="bm-input bm-input-text" id="pgsql-completion-email" placeholder="user@example.com" onkeyup="BM.validateEmail(this)" onchange="BM.validateEmail(this)">
                <span class="bm-email-error">Invalid Email</span>
            </div>
        </div>
        <div>
            <button class="bm-btn bm-btn-primary" onclick="BM.restoreDb('pgsql', this)">Restore</button>
            <div id="alert-restore-pgsql" class="bm-alert"></div>
        </div>
    </div>
</div>

</div><!-- /restore-forms -->
</div><!-- /restore tab -->


<!-- ============================================
     TAB 3: Storage Breakdown
     ============================================ -->
<div id="bm-tab-sizes" class="bm-tab-content">

<h2>System Backups</h2>
<div class="bm-card">
    <div class="bm-size-header">
        <div class="bm-size-label">Backup Type</div>
        <div class="bm-size-value">Backup Usage</div>
    </div>
    <div class="bm-size-row"><div class="bm-size-label">System Directories</div><div class="bm-size-value" id="bm-size-dirs">--</div></div>
    <div class="bm-size-row"><div class="bm-size-label">System MySQL Databases</div><div class="bm-size-value" id="bm-size-mysql">--</div></div>
    <div class="bm-size-row"><div class="bm-size-label">System PgSQL Databases</div><div class="bm-size-value" id="bm-size-pgsql">--</div></div>
    <div class="bm-size-row"><div class="bm-size-label">System Grace <span class="bm-help-icon" data-help="Extra space for System Backups provided for free which does not count against your quota.">ⓘ</span></div><div class="bm-size-value" id="bm-size-grace">--</div></div>
    <div class="bm-size-row"><div class="bm-size-label"><strong>System Total</strong></div><div class="bm-size-value" id="bm-size-sys-total"><strong>--</strong></div></div>
</div>

<h2>cPanel User Backups</h2>
<div class="bm-card">
    <div class="bm-row">
        <div class="bm-col-3">
            <label class="bm-toggle">
                <input type="checkbox" id="limit-cpusers" onchange="BM.enableChanged('cpuser-limits')">
                <span class="bm-toggle-track"><span class="bm-toggle-thumb"></span></span>
                <span class="bm-toggle-label">Limit Account Usage</span>
            </label>
        </div>
        <div class="bm-col-4 bm-form-inline" id="cpuser-limits-default-wrap">
            <label>Default limit for new accounts</label>
            <input type="number" class="bm-input bm-input-num" id="cpuser-limit-default" value="0" min="0" step="0.1"> GiB
        </div>
        <div class="bm-col-5" id="cpuser-limits-email-wrap">
            <div class="bm-form-inline">
                <label>Email for Notifications</label>
                <input type="text" class="bm-input bm-input-text" id="cpuser-limit-email" placeholder="user@example.com" onkeyup="BM.validateEmail(this)" onchange="BM.validateEmail(this)">
                <span class="bm-email-error">Invalid Email</span>
            </div>
        </div>
    </div>
    <hr>
    <div class="bm-size-header">
        <div style="flex:0 0 200px;">cPanel User</div>
        <div style="flex:0 0 100px;text-align:right;">Backup Usage</div>
        <div style="flex:0 0 120px;" id="cpuser-limits-options"></div>
        <div style="flex:0 0 120px;text-align:center;" id="cpuser-limits-hdr-limit" class="bm-hidden">Backup Limit</div>
        <div style="flex:0 0 100px;text-align:center;" id="cpuser-limits-hdr-notify" class="bm-hidden">Notify</div>
    </div>
    <div id="bm-cpuser-rows">
        <div class="bm-loading"><span class="bm-spinner"></span> Loading...</div>
    </div>
    <div class="bm-size-row">
        <div class="bm-size-label"><strong>cPanel User Total</strong></div>
        <div class="bm-size-value" id="bm-cpuser-total"><strong>--</strong></div>
    </div>
</div>

<div id="bm-extra-users-section" class="bm-hidden">
    <h2>Extra Users</h2>
    <div class="bm-card">
        <p>These cPanel users don't belong on this server according to AMP. They will not be backed up from this server.</p>
        <ul id="bm-extra-users-list"></ul>
    </div>
</div>

<div class="bm-row" style="margin-top:1em;">
    <div class="bm-col-6">
        <button class="bm-btn bm-btn-primary" onclick="BM.saveCpuserLimits(this)">Save cPanel User Limit Settings</button>
        <div id="alert-cpuser-limit-save" class="bm-alert"></div>
    </div>
    <div class="bm-col-6 bm-text-right">
        <button class="bm-btn bm-btn-warning bm-btn-sm" onclick="BM.resetModal('storage', 'Storage Breakdown')">Reset cPanel User Limit Settings</button>
    </div>
</div>

</div><!-- /sizes tab -->


<!-- ============================================
     TAB 4: Queue Status
     ============================================ -->
<div id="bm-tab-status" class="bm-tab-content">
<button class="bm-btn bm-btn-info bm-btn-sm" id="bm-status-refresh-btn" onclick="BM.refreshStatus()">Refresh</button>
<div id="bm-status-data" class="bm-status-content">
    <div class="bm-loading"><span class="bm-spinner"></span> Loading status...</div>
</div>
</div><!-- /status tab -->


<!-- ============================================
     TAB 5: System Performance Tuning
     ============================================ -->
<div id="bm-tab-tuning" class="bm-tab-content">

<p><strong>The defaults in this tab should be fine for most cases.</strong>
This tab is for tweaking variables that impact backup performance and prevent them from impacting website performance.</p>

<div class="bm-card">

<!-- Backup Load Settings -->
<h3>Max Server Backup Load</h3>
<p>Intensive backup processes will attempt to pause and resume based on server load.</p>
<div class="bm-pad-left">
    <h3>Select Peak Hours</h3>
    <div class="bm-pad-left">
        <p>Hours when backups can run at higher load (low-traffic hours). <em>Timezone is server time.</em></p>
        <div class="bm-form-group">
            <select id="backup-peak-hours" class="bm-select" multiple size="6" style="min-width:200px;min-height:150px;">
                <?php for ($h = 0; $h < 24; $h++): ?>
                    <?php
                    $hr12 = $h % 12 ?: 12;
                    $mer = $h < 12 ? 'AM' : 'PM';
                    ?>
                    <option value="<?php echo $h; ?>"><?php echo sprintf('%02d:00%s to %02d:59%s', $hr12, $mer, $hr12, $mer); ?></option>
                <?php endfor; ?>
            </select>
            <p><em>Hold Ctrl/Cmd to select multiple hours.</em></p>
        </div>
    </div>

    <h3>Peak-Hours Load</h3>
    <div class="bm-pad-left bm-form-inline">
        <span>Peak-Hours Max Load</span>
        <input type="number" class="bm-input bm-input-num" id="backup-peak-load-input" value="4" min="0.01" max="64" step="0.01">
        <label><input type="checkbox" id="backup-peak-load-checkbox"> Multiply by CPU cores</label>
        <span>Total: <strong id="backup-peak-load-total">--</strong></span>
    </div>

    <h3>Off-Hours Load</h3>
    <div class="bm-pad-left bm-form-inline">
        <span>Off-Hours Max Load</span>
        <input type="number" class="bm-input bm-input-num" id="backup-off-load-input" value="2" min="0.01" max="64" step="0.01">
        <label><input type="checkbox" id="backup-off-load-checkbox"> Multiply by CPU cores</label>
        <span>Total: <strong id="backup-off-load-total">--</strong></span>
    </div>

    <h3>Pausing Behavior</h3>
    <div class="bm-pad-left">
        <p>When max load is reached, processes intermittently resume to prevent timeouts.</p>
        <div class="bm-form-inline"><span>Sleep Seconds</span> <input type="number" class="bm-input bm-input-num" id="backup-sleep-secs" value="30" min="0" max="180" step="0.1"></div>
        <div class="bm-form-inline"><span>Run Seconds</span> <input type="number" class="bm-input bm-input-num" id="backup-run-secs" value="10" min="0" max="180" step="0.1"></div>
    </div>
</div>

<hr>
<!-- Backup Parallel -->
<h3>Backup Parallel Processing</h3>
<div class="bm-pad-left bm-form-inline" id="backup-parallel-section">
    <span>Parallel Processes</span>
    <input type="number" class="bm-input bm-input-num" id="backup-parallel-input" value="1" min="1" max="64" step="1">
    <label><input type="checkbox" id="backup-parallel-checkbox"> Multiply by CPU cores</label>
    <span>Total: <strong id="backup-parallel-total">--</strong></span>
</div>

<hr>
<!-- Restore Parallel -->
<h3>Restore Parallel Processing</h3>
<div class="bm-pad-left bm-form-inline" id="restore-parallel-section">
    <span>Parallel Processes</span>
    <input type="number" class="bm-input bm-input-num" id="restore-parallel-input" value="1" min="1" max="64" step="1">
    <label><input type="checkbox" id="restore-parallel-checkbox"> Multiply by CPU cores</label>
    <span>Total: <strong id="restore-parallel-total">--</strong></span>
</div>

<hr>
<!-- Max CPU -->
<h3>Max CPU cores</h3>
<div class="bm-pad-left">
    <p>Max CPU cores used per backup process. (0 = unlimited)</p>
    <input type="number" class="bm-input bm-input-num" id="max_cpus" value="0" min="0" step="1">
</div>

<hr>
<!-- Bandwidth -->
<h3>Bandwidth</h3>
<div class="bm-pad-left bm-form-inline">
    <span>Upload Bandwidth Limit</span>
    <input type="number" class="bm-input bm-input-num" id="bwlimit" value="0" min="0" step="1">
    <span>Kbit/s (0 = unlimited)</span>
</div>

</div><!-- /main tuning card -->

<!-- Restore Load (shown on shared) -->
<div class="bm-card bm-hidden" id="bm-restore-load-section">
<h3>Max Server Restore Load</h3>
<div class="bm-pad-left">
    <h3>Select Peak Hours</h3>
    <div class="bm-pad-left">
        <select id="restore-peak-hours" class="bm-select" multiple size="6" style="min-width:200px;min-height:150px;">
            <?php for ($h = 0; $h < 24; $h++): ?>
                <?php $hr12 = $h % 12 ?: 12; $mer = $h < 12 ? 'AM' : 'PM'; ?>
                <option value="<?php echo $h; ?>"><?php echo sprintf('%02d:00%s to %02d:59%s', $hr12, $mer, $hr12, $mer); ?></option>
            <?php endfor; ?>
        </select>
    </div>
    <h3>Peak-Hours Load</h3>
    <div class="bm-pad-left bm-form-inline">
        <input type="number" class="bm-input bm-input-num" id="restore-peak-load-input" value="4" min="0.01" max="64" step="0.01">
        <label><input type="checkbox" id="restore-peak-load-checkbox"> Multiply by CPU cores</label>
    </div>
    <h3>Off-Hours Load</h3>
    <div class="bm-pad-left bm-form-inline">
        <input type="number" class="bm-input bm-input-num" id="restore-off-load-input" value="2" min="0.01" max="64" step="0.01">
        <label><input type="checkbox" id="restore-off-load-checkbox"> Multiply by CPU cores</label>
    </div>
    <h3>Pausing Behavior</h3>
    <div class="bm-pad-left">
        <div class="bm-form-inline"><span>Sleep Seconds</span> <input type="number" class="bm-input bm-input-num" id="restore-sleep-secs" value="30" min="0" max="180" step="0.1"></div>
        <div class="bm-form-inline"><span>Run Seconds</span> <input type="number" class="bm-input bm-input-num" id="restore-run-secs" value="10" min="0" max="180" step="0.1"></div>
    </div>
</div>
</div>

<!-- Cache Calculation (non-VPS) -->
<div class="bm-hidden" id="bm-cache-calc-section">
<h2>Size Calculation Cron</h2>
<div class="bm-card">
    <h3>Max Server Cache Calculation Load</h3>
    <p>Size information is cached ahead of time. These processes can be tuned like backup processes.</p>
    <div class="bm-pad-left">
        <h3>Peak Hours</h3>
        <div class="bm-pad-left">
            <select id="cache-calculation-peak-hours" class="bm-select" multiple size="6" style="min-width:200px;min-height:150px;">
                <?php for ($h = 0; $h < 24; $h++): ?>
                    <?php $hr12 = $h % 12 ?: 12; $mer = $h < 12 ? 'AM' : 'PM'; ?>
                    <option value="<?php echo $h; ?>"><?php echo sprintf('%02d:00%s to %02d:59%s', $hr12, $mer, $hr12, $mer); ?></option>
                <?php endfor; ?>
            </select>
        </div>
        <h3>Peak Load</h3>
        <div class="bm-pad-left bm-form-inline">
            <input type="number" class="bm-input bm-input-num" id="cache-calculation-peak-load-input" value="4" min="0.01" max="64" step="0.01">
            <label><input type="checkbox" id="cache-calculation-peak-load-checkbox"> Multiply by CPU cores</label>
        </div>
        <h3>Off-Hours Load</h3>
        <div class="bm-pad-left bm-form-inline">
            <input type="number" class="bm-input bm-input-num" id="cache-calculation-off-load-input" value="2" min="0.01" max="64" step="0.01">
            <label><input type="checkbox" id="cache-calculation-off-load-checkbox"> Multiply by CPU cores</label>
        </div>
        <h3>Pausing Behavior</h3>
        <div class="bm-pad-left">
            <div class="bm-form-inline"><span>Sleep Seconds</span> <input type="number" class="bm-input bm-input-num" id="cache-calculation-sleep-secs" value="30" min="0" max="180" step="0.1"></div>
            <div class="bm-form-inline"><span>Run Seconds</span> <input type="number" class="bm-input bm-input-num" id="cache-calculation-run-secs" value="10" min="0" max="180" step="0.1"></div>
        </div>
        <h3>Parallel Processing</h3>
        <div class="bm-pad-left bm-form-inline">
            <input type="number" class="bm-input bm-input-num" id="cache-calculation-parallel-input" value="1" min="1" max="64" step="1">
            <label><input type="checkbox" id="cache-calculation-parallel-checkbox"> Multiply by CPU cores</label>
        </div>
    </div>
</div>
</div>

<!-- Logging -->
<h2>Logging</h2>
<div class="bm-card">
    <div class="bm-pad-left">
        <p><strong>Filter what gets logged in /var/log/backup-runner.log</strong></p>
        <p>It's usually best to leave this as INFO unless troubleshooting.</p>
        <div class="bm-radio-group bm-pad-left">
            <label><input type="radio" name="loglevel" value="DEBUG"> DEBUG: Shows everything</label>
            <label><input type="radio" name="loglevel" value="INFO" checked> INFO: Shows info, warning, error, &amp; critical</label>
            <label><input type="radio" name="loglevel" value="WARNING"> WARNING: Shows warning, error, &amp; critical</label>
            <label><input type="radio" name="loglevel" value="ERROR"> ERROR: Shows error &amp; critical</label>
            <label><input type="radio" name="loglevel" value="CRITICAL"> CRITICAL: Only shows critical</label>
        </div>
    </div>
</div>

<!-- Temp Files -->
<h2>Temporary Files</h2>
<div class="bm-card">
    <p>While backup processes are running, this is where they will store temporary files</p>
    <div class="bm-form-inline">
        <label>TMPDIR</label>
        <input type="text" class="bm-input bm-input-text" id="restic-tmp" value="/tmp">
    </div>
</div>

<!-- Plugin du timeout -->
<h2>Plugins</h2>
<div class="bm-card">
    <p>Timeout for cPanel plugins' processes used to estimate account sizes.</p>
    <div class="bm-form-inline">
        <input type="number" class="bm-input bm-input-num" id="plugin-du-timeout" value="60" min="1" step="1">
        <span>secs</span>
    </div>
</div>

<div class="bm-row" style="margin-top:1em;">
    <div class="bm-col-6">
        <button class="bm-btn bm-btn-primary" onclick="BM.saveTuning(this)">Save System Tuning Settings</button>
        <div id="alert-save-tuning" class="bm-alert"></div>
    </div>
    <div class="bm-col-6 bm-text-right">
        <button class="bm-btn bm-btn-warning bm-btn-sm" onclick="BM.resetModal('tuning', 'System Performance Tuning')">Reset System Tuning Settings</button>
    </div>
</div>

</div><!-- /tuning tab -->


<!-- ============================================
     Modals
     ============================================ -->

<!-- Log Viewer Modal -->
<div class="bm-modal-overlay" id="bm-log-modal">
    <div class="bm-modal">
        <div class="bm-modal-header"><h3>Fail Log</h3><button class="bm-modal-close" onclick="BM.closeModal('bm-log-modal')">&times;</button></div>
        <div class="bm-modal-body" id="bm-log-modal-body"></div>
        <div class="bm-modal-footer"><button class="bm-btn bm-btn-info" onclick="BM.closeModal('bm-log-modal')">Close</button></div>
    </div>
</div>

<!-- Ticket Modal -->
<div class="bm-modal-overlay" id="bm-ticket-modal">
    <div class="bm-modal">
        <div class="bm-modal-header"><h3>Submit a Ticket</h3><button class="bm-modal-close" onclick="BM.closeModal('bm-ticket-modal')">&times;</button></div>
        <div class="bm-modal-body">
            <p>Logs will be included in the ticket for troubleshooting.</p>
            <p>Please include any additional information or requests here:</p>
            <textarea class="bm-textarea" id="bm-ticket-body" rows="6"></textarea>
        </div>
        <div class="bm-modal-footer">
            <div id="alert-ticket-error" class="bm-alert"></div>
            <button class="bm-btn bm-btn-primary" id="bm-ticket-do-btn" onclick="BM.makeTicket()">Submit Ticket</button>
            <button class="bm-btn bm-btn-info" onclick="BM.closeModal('bm-ticket-modal')">Cancel</button>
        </div>
    </div>
</div>

<!-- Reset Confirm Modal -->
<div class="bm-modal-overlay" id="bm-reset-modal">
    <div class="bm-modal">
        <div class="bm-modal-header"><h3>Reset Settings?</h3><button class="bm-modal-close" onclick="BM.closeModal('bm-reset-modal')">&times;</button></div>
        <div class="bm-modal-body">
            <p><strong>⚠ Reset all settings in the <em id="bm-reset-tab-name">(error)</em> tab to defaults?</strong></p>
            <div id="bm-reset-diff-loading"><span class="bm-spinner"></span> Loading...</div>
            <div id="bm-reset-diff"></div>
        </div>
        <div class="bm-modal-footer">
            <div id="alert-reset-error" class="bm-alert"></div>
            <button class="bm-btn bm-btn-danger" id="bm-reset-confirm-btn" onclick="BM.confirmReset()">Reset</button>
            <button class="bm-btn bm-btn-info" onclick="BM.closeModal('bm-reset-modal')">Cancel</button>
        </div>
    </div>
</div>

</div><!-- /bm-wrap -->

<!-- Pass config to JS -->
<script>
window.BM_CONFIG = {
    cgiUrl: <?php echo json_encode($CGI_BACKEND); ?>,
    isCPanel: <?php echo json_encode($isCPanelServer); ?>,
    isCWP: <?php echo json_encode($isCWPServer); ?>
};
</script>

<?php
$js_src = $isCWPServer ? 'design/js/imh-backup-manager.js' : 'imh-backup-manager.js';
?>
<script src="<?php echo htmlspecialchars($js_src); ?>"></script>

<?php

// ==========================
// Footer
// ==========================

if ($isCPanelServer) {
    WHM::footer();
} else {
    echo '</div>'; // Close panel-body
}
?>
