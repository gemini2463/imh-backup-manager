/* show a popup modal when a button is clicked to reset settings */
function reset_modal(tab, name) {
  var modal = $('#reset-confirm');
  // Change the "Reset all settings in the <HERE> tab to defaults?" text
  $('#reset-tab-name').text(name);
  // store this for confirm_reset() to use later
  modal.data('tab', tab);
  // Reset any errors on the restore modal
  $('#alert-reset-error').hide();
  // Disable buttons while loading ajax request
  var confirm_button = $('#reset-confirm-button');
  confirm_button.prop('disabled', true); // reset button on form
  confirm_button.text('Loading...');
  $('.btn-reset').prop('disabled', true); // buttons on the tabs
  $('#reset-diff-loading').show(); // Show loading animation
  $('#reset-diff').hide(); // diff area not ready until request is done
  // show the modal
  modal.modal('show');
  // perform the ajax request
  var alert = $('#alert-reset-error');
  $.ajax({
    url: './backups.cgi',
    type: 'POST',
    timeout: 120 * 1000,
    data: {action: 'reset_'.concat(tab), args: JSON.stringify({confirm: false})}
  })
  .done(function(data){
    $('#reset-diff-loading').hide();
    var diff_area = $('#reset-diff');
    diff_area.html(data);
    diff_area.show();
    confirm_button.prop('disabled', false);
    confirm_button.text('Reset');
    $('.btn-reset').prop('disabled', false);
  })
  .fail(function(data){
    $('#reset-diff-loading').hide();
    $('.btn-reset').prop('disabled', false);
    confirm_button.text('Error');
    show_alert(alert, data.responseText, false);
    console.log(data.responseText);
  });
}

/* When the confirm button is clicked in the reset settings modal */
function confirm_reset() {
  var button = $('#reset-confirm-button');
  var modal = $('#reset-confirm');
  var tab = modal.data('tab'); // storage, tuning, or settings
  var alert = $('#alert-reset-error');
  button.prop('disabled', false);
  button.text('Please wait...');
  $.ajax({
    url: './backups.cgi',
    type: 'POST',
    timeout: 120 * 1000,
    data: {action: 'reset_'.concat(tab), args: JSON.stringify({confirm: true})}
  })
  .done(function(data){
    alert.addClass('alert-success');
    alert.removeClass('alert-danger');
    alert.text('Refreshing...');
    alert.show();
    location.reload(true);
  })
  .fail(function(data){
    show_alert(alert, data.responseText, false);
    console.log(data.responseText);
  });
}
