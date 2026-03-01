/* updates the list of restores in queue and completed */
function update_restore_queues(){
  var outer_div = $('#restorations-div');
  var timer_alert = $('#timer-error');
  var prev_tags = [];
  $('.tagged-item').each(function(index, elem) {
    var elem = $(elem);
    prev_tags.push(elem.data('tag'));
  });
  var params = {prev_tags_loaded: prev_tags};
  $.post({
    url: './backups.cgi',
    type: 'POST',
    timeout: 120 * 1000,
    data: {action: 'get_restore_queue', args: JSON.stringify(params)}
  })
  .done(function(html){
    outer_div.empty();
    outer_div.html(html);
    timer_alert.hide();
    reset_timer($('#do-timer').data('do-timer'));
  })
  .fail(function(data){
    console.log(data.responseText);
    show_alert($('#alert-timer-error'), 'Error fetching restore queue', false);
    reset_timer(false);
  });
}

/* used by update_restore_queues to reset the timer */
function reset_timer(do_timer){
  var refreshing_line = $('#refreshing');
  var timer_span = $('#timer');
  timer_span.text(timer_span.data('dur'));
  if (do_timer){
    refreshing_line.show();
    if (window.countdown_timer == undefined ){
      window.countdown_timer = setInterval(update_countdown, 1000);
    }
  } else {
    refreshing_line.hide();
  }
}

/* triggered restore browser when selections change */
function dirs_restore_enable(has_items){
  var btn = $('#dirs-restore-confirm-button')
  btn.prop('disabled', !has_items);
}

/* decrements the timer and runs update_queues again at 0 */
function update_countdown(){
  var span = $('#timer');
  var num = Number(span.text());
  if (num > 1){
    span.text(num - 1);
  } else {
    span.text('0');
    // update_restore_queues will start the timer again if needed
    clearInterval(window.countdown_timer);
    window.countdown_timer = undefined;
    update_restore_queues();
  }
}

/* displays a log viewer when "View Fail Log" is clicked on a restore */
function view_fail_log(link){
  link = $(link);
  var div = $('#log-modal-body');
  div.empty();
  $.each(link.data('log'), function(e_id, entry){
    var date = new Date(entry[0] * 1000);
    var msg = entry[1];
    var p = $('<p>');
    p.append($('<strong>', {text: date}));
    p.append(' '.concat(msg));
    div.append(p);
  });
  $('#log-modal').modal('show');
}

/* rudimentary check for email validation */
function validate_email(input){
  var input = $(input);
  var email = $.trim(input.val());
  if (email == ''){
    var valid = true;
  } else {
    // not true RFC 5322 support but "close enough." see emailregex.com
    var regex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    var valid = email.match(regex) != null;
  }
  var form_group = input.closest('.form-group');
  if (valid){
    form_group.removeClass('has-error');
    form_group.find('.email-error').addClass('hidden');
    if (email == ''){
      input.data('filled', false);
    } else {
      input.data('filled', true);
    }
  } else {
    form_group.addClass('has-error');
    form_group.find('.email-error').removeClass('hidden');
    input.data('filled', false);
  }
}

/* when the restore button is clicked for a database */
function restore_db(backup_type, button){
  button = $(button);
  var confirm = confirm_restore(button);
  if (!confirm){
    return;
  }
  hide_confirm(button);
  var email_input = $('#'.concat(backup_type).concat('-completion-email'));
  if (email_input.data('filled')){
    var email = email_input.val();
  } else {
    var email = '';
  }
  var params = {
    snap_id: $('#'.concat(backup_type).concat('-dbname option:selected')).val(),
    dbname: $('#'.concat(backup_type).concat('-dbname option:selected')).text(),
    date: $('#'.concat(backup_type).concat('-date option:selected')).data('stamp'),
    geo: parseInt($('#'.concat(backup_type).concat('-date option:selected')).val().substr(0, 1)),
    target: $('#'.concat(backup_type).concat('-path')).val(),
    mode: $('input[name='.concat(backup_type).concat('-method]:checked')).val(),
    email: email
  };
  var alert = $('#alert-restore-'.concat(backup_type));
  if (!params['target'].startsWith('/')){
    show_alert(alert, '"Restore to" must be a full path', false);
    return;
  }
  do_post('restore_'.concat(backup_type), params, button, alert, function(){
    $("html, body").animate({scrollTop: $('#restore-tab').position().top}, 500);
    update_restore_queues();
  });
}

/* when the date dropdown in a database restore section changes */
function db_date_changed(id){
  var date_select = $(id);
  var option = date_select.find('option:selected')
  if (option.length != 1){
    console.log('no 1 option selected under '.concat(id));
    return;
  }
  var dbs = option.data('dbs');
  var dbname_select= $(date_select.data('dbselect'));
  dbname_select.empty();
  $.each(dbs, function(dbname, snapshot){
    dbname_select.append($('<option>', {value: snapshot, text: dbname}));
  });
  return;
}

/* then the cancel button next to an ongoing restore is clicked */
function cancel_restore_item(link){
  link = $(link);
  var params = {tag: link.data('tag')};
  var alert = $('#alert-queue-msg');
  do_post('cancel_restore', params, link, alert, update_restore_queues);
}

/* Shows the "Submit Ticket" popup modal */
function ticket_modal(link){
  link = $(link);
  var tag = link.data('tag');
  if (link.data('sent') == 'y'){
    return;
  }
  if (window.tickets_submitted.indexOf(tag) != -1){
    console.log('ticket already submitted for '.concat(tag));
    show_alert($('#alert-queue-msg'), 'ticket already submitted', false);
    return;
  }
  // access data attrs of the link and place them on the modal before showing
  var log = link.data('log');
  var task = link.data('task');
  var params = link.data('params');
  var modal = $('#ticket-modal');
  $('#ticket-do-btn').prop('disabled', false);
  $('#ticket-do-btn').text('Submit Ticket');
  $('#alert-ticket-error').hide();
  modal.data('tag', tag);
  modal.data('log', log);
  modal.data('task', task);
  modal.data('params', params);
  modal.modal('show');
}

/* when "Submit Ticket" is clicked in the popup modal, this emails support */
function make_ticket(){
  var modal = $('#ticket-modal')
  var log = modal.data('log');
  var task = modal.data('task');
  var backup_params = modal.data('params');
  var tag = modal.data('tag');
  var submit_btn = $('#ticket-do-btn');
  submit_btn.prop('disabled', true);
  submit_btn.text('Please wait...');
  var params = {
    ipaddr: window.remote_ip,
    task: task,
    log: log,
    params: backup_params,
    msg: $('#ticket-body').val()
  };
  do_post('make_ticket', params, submit_btn, $('#alert-ticket-error'), function(data){
    modal.modal('hide');
    window.tickets_submitted.push(tag);
    $('#ticket-body').val('');
  });
}

/* hides the confirm div from confirm_restore() */
function hide_confirm(elem){
  var elem = $(elem); // any element within the restore confirm div
  var confirm_div = elem.closest('.restore-confirm');
  var confirm_msg = confirm_div.find('.restore-confirm-msg');
  var cancel_link = confirm_div.find('.restore-alert-cancel');
  confirm_msg.hide();
  cancel_link.hide();
  confirm_div.data('shown', false);
  confirm_div.removeClass('alert alert-danger restore-confirm-active');
}

/* shows a confirm div or returns true if already shown */
function confirm_restore(button){
  var confirm_div = button.closest('.restore-confirm');
  if (confirm_div.data('shown')){
    return true;
  } else {
    var confirm_msg = confirm_div.find('.restore-confirm-msg');
    var cancel_link = confirm_div.find('.restore-alert-cancel');
    confirm_msg.show();
    cancel_link.show();
    confirm_div.data('shown', true);
    confirm_div.addClass('alert alert-danger restore-confirm-active');
    return false;
  }
}

/* when the restore button is clicked for a system dir backup */
function restore_dirs(button){
  var button = $(button);
  var confirm = confirm_restore(button);
  if (!confirm){
    return;
  }
  hide_confirm(button);
  var alert = $('#alert-restore-dirs');
  var email_input = $('#dirs-completion-email');
  if (email_input.data('filled')){
    var email = email_input.val();
  } else {
    var email = '';
  }
  var params = {
    paths: get_browser_selected('#restore-filebrowser'),
    date: $('#dirs-date option:selected').data('stamp'),
    snap_id: $('#dirs-date option:selected').data('snap'),
    geo: $('#dirs-date option:selected').data('geo'),
    mode: $('input[name=dirs-method]:checked').val(),
    email: email
  };
  if (params['paths'].length == 0){
    show_alert(alert, 'No paths selected', false)
    return;
  }
  if (params['mode'] == 'target'){
    params['target'] = $('#dirs-target').val();
    if (!params['target'].startsWith('/')){
      show_alert(alert, '"Restore to" must be a full path', false);
      return;
    }
  }
  do_post('restore_dirs', params, button, alert, function(){
    $("html, body").animate({scrollTop: $('#restore-tab').position().top}, 500);
    update_restore_queues();
  });
}
