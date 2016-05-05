
// CLI usage:
// phantomjs [--ssl-protocol=any] ge-cancellation-checker.phantom.js [-v|--verbose]

var system = require('system');
var fs = require('fs');

var VERBOSE = false;
var loadInProgress = false;

// Calculate path of this file
var PWD = '';
var current_path_arr = system.args[0].split('/');
if (current_path_arr.length == 1) { PWD = '.'; }
else {
    current_path_arr.pop();
    PWD = current_path_arr.join('/');
}


// Gather Settings...
try {
    var contents = fs.read(PWD + '/config.json');
    var settings = JSON.parse(contents);
    if (!settings.username || !settings.username || !settings.init_url || !settings.enrollment_location_ids) {
        console.log('Missing username, password, enrollment location ID, and/or initial URL. Exiting...');
        phantom.exit();
    }
}
catch(e) {
    console.log('Could not read config.json', e);
    phantom.exit();
}

// ...from command
system.args.forEach(function(val, i) {
    if (val == '-v' || val == '--verbose') { VERBOSE = true; }
});

function fireClick(el) {
    var ev = document.createEvent("MouseEvents");
    ev.initEvent("click", true, true);
    el.dispatchEvent(ev);
}

var page = require('webpage').create();

page.onConsoleMessage = function(msg) {
    if (!VERBOSE) { return; }
    console.log(msg);
};

page.onError = function(msg, trace) {
    if (!VERBOSE) { return; }
    console.error('Error on page (', page.url, ' ): ', msg);
}

page.onCallback = function (data) {
    var query = data.msg;
    if (query == 'username') { return settings.username; }
    if (query == 'password') { return settings.password; }
    if (query == 'fireClick') {
        return function() { return fireClick; } // @todo:david DON'T KNOW WHY THIS DOESN'T WORK! :( Just returns [Object object])
    }
    if (query == 'report-interview-time') {
        if (VERBOSE) { console.log('Next available appointment at location ', data.location, ' is at: ', data.date); }
        else { console.log(msg); }
        return;  
    }
    if (query == 'fatal-error') {
        console.log('Fatal error: ' + msg);
        phantom.exit();
    }
    return null;
}

page.onLoadStarted = function () {
    loadInProgress = true;
};
page.onLoadFinished = function () {
    // if (VERBOSE) { console.log('Page loaded:', page.url); }
    loadInProgress = false;
};

if (VERBOSE) { console.log('Please wait...'); }

page.open(settings.init_url);
var loginSteps = [
    function () { // Log in
        page.evaluate(function () {
            console.log('On GOES login page...');
            document.querySelector('input[name=username]').value = window.callPhantom({ msg: 'username' });
            document.querySelector('input[name=password]').value = window.callPhantom({ msg: 'password' });
            document.querySelector('form[action="/pkmslogin.form"]').submit();
            console.log('Logging in...');
        });
    },
    function () { // Accept terms
        page.evaluate(function () {

            function fireClick(el) {
                var ev = document.createEvent("MouseEvents");
                ev.initEvent("click", true, true);
                el.dispatchEvent(ev);
            }

            var $acceptTermsBtn = document.querySelector('a[href="/main/goes/HomePagePreAction.do"]');

            if (!$acceptTermsBtn) {
                return window.callPhantom({ msg: 'fatal-error', error: 'Unable to find terms acceptance button' });
            }

            fireClick($acceptTermsBtn);
            console.log('Accepting terms...');
        });
    },
    function () { // main dashboard
        page.evaluate(function () {

            function fireClick(el) {
                var ev = document.createEvent("MouseEvents");
                ev.initEvent("click", true, true);
                el.dispatchEvent(ev);
            }

            var $manageAptBtn = document.querySelector('.bluebutton[name=manageAptm]');
            if (!$manageAptBtn) {
                return window.callPhantom({ msg: 'fatal-error', error: 'Unable to find Manage Appointment button' });
            }

            fireClick($manageAptBtn);
            console.log('Entering appointment management...');
        });
    },
    function () {
        page.evaluate(function () {

            function fireClick(el) {
                var ev = document.createEvent("MouseEvents");
                ev.initEvent("click", true, true);
                el.dispatchEvent(ev);
            }

            var $rescheduleBtn = document.querySelector('input[name=reschedule]');

            if (!$rescheduleBtn) {
                return window.callPhantom({ msg: 'fatal-error', error: 'Unable to find reschedule button. Is it after or less than 24 hrs before your appointment?' });
            }

            fireClick($rescheduleBtn);
            console.log('Entering rescheduling selection page...');
        });
    }];



var searchSteps = [
    function(location_id) {
        page.evaluate(function(location_id) {

            document.querySelector('select[name=selectedEnrollmentCenter]').value = location_id;
            document.querySelector('form').submit()
            console.log('Choosing: ', location_id);
        }, location_id);
    },
    function(location_id) {

        page.evaluate(function(location_id) {

            // We made it! Now we have to scrape the page for the earliest available date
            
            var date = document.querySelector('.date table tr:first-child td:first-child').innerHTML;
            var month_year = document.querySelector('.date table tr:last-child td:last-child div').innerHTML;

            var full_date = month_year.replace(',', ' ' + date + ',');
            // console.log('');
            window.callPhantom({ msg: 'report-interview-time', date: full_date, location: location_id });
            // console.log('The next available appointment is on ' + full_date + '.');
        }, location_id);
    }
];

function chooseAnotherCenter() {
    console.log('About to select another center to search...');
    page.open('https://goes-app.cbp.dhs.gov/main/goes/SelectEnrollmentCenterPreAction.do');
}

var i = 0;
var locations_ids = settings.enrollment_location_ids;
function login() {
    loginInterval = setInterval(function() {
        if (loadInProgress) { return; } // not ready yet...

        if (typeof loginSteps[i] != "function") {
            clearInterval(loginInterval);
            i = 0;
            return searchForAppointment();
        }
        if (VERBOSE) { console.log('Running login step #', i); }
        loginSteps[i]();
        i++;

    }, 500);
}

var locationIndex = 0;
var searchInterval; 
function searchForAppointment(location) {
    if (!location) {
        searchSteps.splice(0, 0, chooseAnotherCenter); // put this inbetween our location checks.
        return searchForAppointment(locations_ids[locationIndex])
    }
    clearInterval(searchInterval);
    searchInterval = setInterval(function () {
        if (loadInProgress) { return; } // not ready yet...
        if (typeof searchSteps[i] != "function") {
            console.log('remaining locations to check:', locations_ids.slice(locationIndex + 1));
            i = 0;
            locationIndex++;
            if (locationIndex == locations_ids.length)
                return phantom.exit();
            return searchForAppointment(locations_ids[locationIndex]);
        }
        searchSteps[i](location);
        i++;
    }, 500);
}

login();