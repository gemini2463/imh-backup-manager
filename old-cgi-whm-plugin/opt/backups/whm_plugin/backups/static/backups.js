$(document).ready(function() {
  // Initializse help popovers
  $('.help').popover({trigger: 'focus'});
  // keeps track of tickets already submitted since refresh to prevent duplicates
  window.tickets_submitted = [];
  // Hide the restoration div which will be loaded in a separate AJAX call,
  // all empty alert messages which are shown as needed, and the timer error message
  $('.alert-msg, .restore-confirm-msg, .restore-alert-cancel').hide();
  // Trigger enable buttons' change so forms are hidden for any already disabled
  $('.checkbox-switch-input').trigger('change');
  // Initialize both "peak hours" selectors in the tuning tab
  $('.peak-hours').multiselect({
    includeSelectAllOption: true,
    enableFiltering: false,
    maxHeight: 350,
    buttonClass: 'btn btn-primary'
  });
  // Trigger date <select> on mysql forms to populate the dbname <select>
  $('.db-date-select').trigger('change');
  // Trigger radio buttons to hide/unhide as needed
  $('input:radio[checked="checked"]').trigger('change');
  // Trigger email validation on current values
  $('.email-input').trigger('change');
  // Update total for multiplier-based tuning settings if needed
  mult_change();
  // Init all tag-it elements
  $('#dirs-paths').tagit({
    readOnly: $('#svr-class').data('salt-managed'),
    removeConfirmation: true,
    allowSpaces: true,
    singleFieldDelimiter: '\n',
    beforeTagAdded: function(event, ui) {
      // Make sure it's a full path
      if (! ui.tagLabel.startsWith('/')) {
        return false;
      }
      // Display the size of this path
      var sizes = $('#dirs-paths').data('sizes');
      if (ui.tagLabel in sizes){
        ui.tag.append($('<span>', {class: 'path-size', text: sizes[ui.tagLabel]}));
      } else {
        ui.tag.append($('<span>', {class: 'path-size', text: ''}));
      }
    },
    preprocessTag: function(val) {
      // Strip paths
      if (!val) { return ''; }
      return val[0].toUpperCase() + val.slice(1, val.length);
    }
  });
  $('#dirs-exclude').tagit({
    readOnly: $('#svr-class').data('salt-managed'),
    removeConfirmation: true,
    allowSpaces: true,
    singleFieldDelimiter: '\n',
    beforeTagAdded: function(event, ui) {
      // Make sure it's a full path
      if (! ui.tagLabel.startsWith('/')) {
        return false;
      }
    },
    preprocessTag: function(val) {
      // Strip paths
      if (!val) { return ''; }
      return val[0].toUpperCase() + val.slice(1, val.length);
    }
  });
  window.restore_browser_shown_once = false;
  $('a[data-toggle="tab"]').on('shown.bs.tab', function (event) {
    if ($(event.target).attr('href') == '#restore-tab' && ! window.restore_browser_shown_once){
      // if this is the first time the restore tab is shown, initialize the file browser
      window.restore_browser_shown_once = true;
      init_file_browse(
        '#restore-filebrowser',
        $('#dirs-date option:selected').data('snap'),
        $('#dirs-date option:selected').data('geo'),
      );
    }
  });
  // Update cpanel user breakdown progress bars
  update_cpuser_limits()
  // Start restore queue timer if needed
  reset_timer($('#do-timer').data('do-timer'));
  // re-initialize the file browser if date selection changes
  $('#dirs-date').on('change', function(){
    init_file_browse(
      '#restore-filebrowser',
      $('#dirs-date option:selected').data('snap'),
      $('#dirs-date option:selected').data('geo'),
    );
  });
  $('#loading-div').remove();
});

/* when a backup type is enable or disabled for root */
function enable_changed(element){
  var bs_switch = $(element);
  // find the divs this toggle hides when disabled
  var divs = $(bs_switch.data('hides'));
  if (bs_switch.prop('checked')) { // if enabled
    divs.show();
  } else {
    divs.hide();
  }
}

/* Set progress bars based on cPanel user usage and their limits */
function update_cpuser_limits(){
  $('.cpuser-row').each(function(index, row){
    var row = $(row);
    var size = row.data('size');
    var limit = row.find('.cpuser-limit input').val();
    var bar = row.find('.progress-bar');
    set_bar(bar, size, limit);
  });
}

/* update a progress/usage bar */
function set_bar(elem, numerator, denominator) {
  if (numerator == '?'){
    elem.css('background-color', 'orangered');
    elem.css('width', '100%');
    elem.text("Data Unavailable");
    return;
  }
  if (denominator <= 0){
    elem.text('DISABLED');
    var percent = 100;
  } else if (numerator > denominator) {
    elem.text('OVER QUOTA');
    var percent = 100;
  } else {
    elem.text('');
    var percent = numerator / denominator * 100
  }
  if (percent <= 30) {
    var color = 'green';
  } else if (percent <= 50) {
    var color = 'goldenrod';
  } else if (percent <= 80) {
    var color = 'orangered';
  } else {
    var color = 'red';
  }
  elem.css('background-color', color);
  elem.css('width', String(percent).concat('%'));
}

/* get scheduling inputs for a backup type */
function get_sched(backup_type){
  var sched = {
    use_interval: $('input[name='.concat(backup_type).concat('-sched]:checked')).val() == 'interval'
  };
  if (sched['use_interval']){
    sched['interval'] = Number($('#'.concat(backup_type).concat('-interval')).val());
  } else {
    sched['hour'] = Number($('#'.concat(backup_type).concat('-hour')).val());
    sched['meridiem'] = $('#'.concat(backup_type).concat('-meridiem option:checked')).val();
    var days = [];
    $('#'.concat(backup_type).concat('-sched-daily input:checked')).each(function(index, input){
      days.push(Number($(input).val()));
    });
    sched['days'] = days;
  }
  return sched;
}

/* when the save button is clicked in settings >> System Directories */
function get_settings_dirs(alert){
  var enable = $('#dirs-enabled').prop('checked');
  if (enable) {
    var params = {
      enable: true,
      paths: $('#dirs-paths').tagit('assignedTags'),
      exclude: $('#dirs-exclude').tagit('assignedTags')
    };
    Object.assign(params, get_sched('dirs'));
  } else {
    var params = {enable: false};
  }
  if (params['enable']) {
    if (params['paths'].length == 0){
      show_alert(alert, 'No paths selected for system directories', false);
      return null;
    }
    if (! params['use_interval'] && params['days'].length == 0){
      show_alert(alert, 'No days selected for system directories', false);
      return null;
    }
  }
  return params;
}

function save_cpuser_limits(button){
  var button = $(button);
  var alert = $('#alert-cpuser-limit-save');
  var email_input = $('#cpuser-limit-email');
  var params = {
    do_limit: $('#limit-cpusers').prop('checked'),
    default_limit: $('#cpuser-limit-default').val(),
    email: email_input.val(),
    limits: {},
    notify: {},
  };
  if (params['do_limit'] && ! email_input.data('filled')) {
    // filled will be false if invalid
    params['email'] = '';
  }
  $('.cpuser-row').each(function(index, row){
    var row = $(row);
    var user = row.data('user');
    var limit = row.find('.cpuser-limit input').val();
    var notify = row.find('.cpuser-notify-switch input[type="checkbox"]').prop('checked');
    params['limits'][user] = limit;
    params['notify'][user] = notify;
  });
  do_post('set_cpuser_limits', params, button, alert);
}


function save_settings_dirs(alert, button){
  var button = $(button);
  var alert = $('#alert-save-dirs');
  var params = get_settings_dirs(alert);
  if (params == null){
    return;
  }
  do_post('save_dirs', params, button, alert);
}

/* collects selections for database backups */
function get_settings_db(backup_type, alert){
  var enable = $('#'.concat(backup_type).concat('-enabled')).prop('checked');
  var cpuser_enabled = $('#'.concat(backup_type).concat('-cpuser-enabled')).prop('checked');
  if (enable) {
    var sched = get_sched(backup_type);
    if (! sched['use_interval'] && sched['days'].length == 0){
      show_alert(alert, 'No days selected for '.concat(backup_type), false);
      return null;
    }
    var mode = $('input[name='.concat(backup_type).concat('-mode]:checked')).val();
    if (mode == 'whitelist' || mode == 'blacklist') {
      var custom = [];
      var inputs = $('#'.concat(backup_type).concat('-mode-').concat(mode).concat(' input:checked'));
      inputs.each(function(i, input){
        custom.push($(input).val());
      });
      if (custom.length == 0){
        show_alert(alert, 'No databases selected for '.concat(backup_type), false);
        return null;
      }
    } else {
      var custom = null;
    }
    return Object.assign({enable: true, custom: custom, mode: mode, cpuser_enabled: cpuser_enabled}, sched);
  }
  return {enable: false, cpuser_enabled: cpuser_enabled}
}

/* when the save button is clicked in settings >> mysql or pgsql */
function save_settings_db(backup_type, button){
  button = $(button);
  var alert = $('#alert-save-'.concat(backup_type));
  var params = get_settings_db(backup_type, alert);
  if (params == null){
    return;
  }
  do_post('save_'.concat(backup_type), params, button, alert);
}

/* when the save all button is clicked at the bottom of the settings tab */
function save_settings_all(button){
  var button = $(button);
  var alert = $('#alert-save-all');
  var dir_params = get_settings_dirs(alert);
  if (dir_params == null){
    return;
  }
  var mysql_params = get_settings_db('mysql', alert);
  if (mysql_params == null){
    return;
  }
  var pgsql_params = get_settings_db('pgsql', alert);
  if (pgsql_params == null){
    return;
  }
  var params = {
    'dirs': dir_params,
    'mysql': mysql_params,
    'pgsql': pgsql_params
  };
  do_post('save_all', params, button, alert);
}

/* get maximum load settings for either restores or backups */
function get_load_settings(queue){
  var settings = {
    peak_hours: $('#'.concat(queue).concat('-peak-hours')).val(),
    off_load: $('#'.concat(queue).concat('-off-load-input')).val(),
    peak_load: $('#'.concat(queue).concat('-peak-load-input')).val(),
    sleep_secs: $('#'.concat(queue).concat('-sleep-secs')).val(),
    run_secs: $('#'.concat(queue).concat('-run-secs')).val(),
  };
  if ($('#'.concat(queue).concat('-off-load-checkbox')).length == 1){
    // multipliers are on the form
    settings['off_mult'] = $('#'.concat(queue).concat('-off-load-checkbox')).is(':checked');
    settings['peak_mult'] = $('#'.concat(queue).concat('-peak-load-checkbox')).is(':checked');
  }
  return settings;
}

/* get parallelism settings */
function get_parallel_settings(queue){
  var settings = {};
  if ($('#'.concat(queue).concat('-parallel-input')).length == 1){
    settings['val'] = $('#'.concat(queue).concat('-parallel-input')).val();
    settings['mult'] = $('#'.concat(queue).concat('-parallel-checkbox')).is(':checked');
  }
  return settings;
}

/* when the save button is clicked in the tuning tab */
function save_tuning(button){
  var button = $(button);
  var alert = $('#alert-save-tuning');
  var params = {
    loglevel: $('input[name=loglevel]:checked').val(),
    bwlimit: $('#bwlimit').val(),
    backups: get_load_settings('backup'),
    backup_parallel: get_parallel_settings('backup'),
    restore_parallel: get_parallel_settings('restore'),
    restic_tmp: $('#restic-tmp').val(),
    plugin_du_timeout: $('#plugin-du-timeout').val(),
    max_cpus: $('#max_cpus').val(),
  };
  if ($('#cache-calculation-peak-load-input').length == 1) {
    params['pre_cache'] = get_load_settings('cache-calculation')
    params['pre_cache_parallel'] = get_parallel_settings('cache-calculation')
  }
  do_post('save_tuning', params, button, alert);
}

/* show an alert */
function show_alert(alert, msg, success){
  if (success) {
    alert.addClass('alert-success');
    alert.removeClass('alert-danger');
    alert.text(msg);
    alert.show();
    setTimeout(
      function(){
        // check against race conditions where they
        // clicked again and got an error
        if ( alert.hasClass('alert-success') ){
          alert.hide();
        }
      },
      3000
    );
  } else {
    alert.addClass('alert-danger');
    alert.removeClass('alert-success');
    alert.text(msg);
    alert.show();
  }
}

/* performs AJAX calls to save data or perform restores */
function do_post(action, args, button, alert, onsuccess){
  button.prop('disabled', true);
  $.ajax({
    url: './backups.cgi',
    type: 'POST',
    timeout: 120 * 1000,
    data: {action: action, args: JSON.stringify(args)}
  })
  .done(function(data) {
    if (alert != null) {
      show_alert(alert, data, true);
    }
    button.prop('disabled', false);
    if (onsuccess != null) {
      onsuccess();
    }
  })
  .fail(function(data) {
    if (alert != null) {
      show_alert(alert, data.responseText, false);
    }
    console.log(data.responseText);
    button.prop('disabled', false);
  });
}

/* whenever "Multiply by CPU cores" or the base value changes */
function mult_change(){
  $('.mult-group').each(function(i, div){
    // for each pair of input and checkbox options
    var div = $(div);
    var num_input = $(div.find('input[type="number"]'));
    var checkbox = div.find('input[type="checkbox"]');
    var has_multiplier = checkbox.length == 1;
    if (has_multiplier){
      // only multi-core non-vps servers have the multiplier checkbox
      checkbox = $(checkbox);
      var total_span = $(div.find('.mult-total'));
      var total = num_input.val();
      if (checkbox.is(':checked')){
        total *= total_span.data('cores');
      }
      total_span.text(Math.round(total * 1000) / 1000);
    }
  });
}
