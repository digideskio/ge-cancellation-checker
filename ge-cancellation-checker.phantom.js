
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
        data.location_name = locationResolver[data.location_id];
        if (VERBOSE) { console.log('\nNext available appointment at location #', data.location_id, '\n(', data.location_name, ')\n is at >>>>>: ', data.date, '\n'); }
        else { console.log(JSON.stringify(data)); }
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
            window.callPhantom({ msg: 'report-interview-time', date: full_date, location_id: location_id});
            // console.log('The next available appointment is on ' + full_date + '.');
        }, location_id);
    }
];

function chooseAnotherCenter() {
    if (VERBOSE) console.log('About to select another center to search...');
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
            if (VERBOSE) console.log('remaining locations to check:', locations_ids.slice(locationIndex + 1));
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




var locationResolver = {
    "5001": "Hidalgo Enrollment Center - 5911 SOUTH STEWART RD,  , MISSION, TX 78572, US",
    "5002": "San Diego -Otay Mesa Enrollment Center - 2500 Paseo Internacional, San Diego, CA 92154, US",
    "5003": "Brownsville Enrollment Center - 3300 South Expressway 77 83, Veterans International Bridge - Los Tomates, Brownsville, TX 78520, US",
    "5004": "Laredo Enrollment Center - 0 Lincoln Juarez Bridge Bldg.2, Laredo, TX 780443130, US",
    "5005": "El Paso Enrollment Center - 797 S. Zaragoza Rd. Bldg.  A, El Paso, TX 79907, US",
    "5006": "Calexico Enrollment Center - 1699 E. Carr Rd, PO BOX 632, Calexico, CA 92231, US",
    "5007": "Nogales Enrollment Center - 9 N. GRAND AVENUE, NOGALES, AZ 85621, US",
    "5020": "Blaine Enrollment Center  - 8115 Birch Bay Square St., Suite 104, BLAINE, WA 98230, US",
    "5021": "Champlain Enrollment Center - 237 West Service Road, Champlain , NY 12919, US",
    "5022": "Buffalo-Ft. Erie Enrollment Center - 10 CENTRAL AVENUE, FORT ERIE, ON L2A1G6, CA",
    "5023": "Detroit Enrollment Center - 2810 WEST FORT STREET, BUILDING B, DETROIT, MI 48226, US",
    "5024": "Port Huron Enrollment Center - 2321 NEXUS Enrollment Center, Pine Grove Ave., Port Huron, MI 48060, US",
    "5025": "Ottawa Enrollment Center - 1000 Airport Parkway Private, Suite 2641 Ottawa Airport 2nd Floor, Ottawa, ON K1V9B4, CA",
    "5026": "Vancouver Enrollment Center - 3211 Grant McConachie Way, Vancouver International Airport, Richmond, BC V7B1Y9, CA",
    "5027": "Toronto Enrollment Center - 6301 Silver Dart Drive , Terminal One-Depatures Level, Mississauga, ON L5P1B2, CA",
    "5028": "Montreal Enrollment Center - 1 Pierre E Trudeau International Airport , 975  Blvd Romeo Vachon. Room T1476, Montreal, QC H2Y1H1, CA",
    "5029": "Winnipeg Enrollment Center - 1970 Winnipeg NEXUS Office, Wellington Room 1074, Winnipeg, MB R3H0E3, CA",
    "5030": "Calgary Enrollment Center - 2000 Airport Rd N.E., Calgary, AB T2E6W5, CA",
    "5031": "Halifax Enrollment Center - U.S. Customs and Border Protection, 1 Bell Boulevard  Comp  1666 Halifax Intl Airport, Enfield, NS B2T1K2, CA",
    "5032": "Edmonton Enrollment Center - 1000 Airport Road, Edmonton International Airport, Edmonton, AB T9E0V3, CA",
    "5040": "Seattle Urban Enrollment Center - 7277 PERIMETER ROAD SOUTH  RM 116, KING COUNTY INTERNATIONAL AIRPORT, BOEING FIELD, SEATTLE, WA 98108, US",
    "5041": "Vancouver Urban Enrollment Center - 1611 Main Street, 4th Floor, VANCOUVER, BC V6A2W5, CA",
    "5060": "Warroad Enrollment Center  - 41059 Warroad Enrollment Center, State Hwy 313 N, Warroad, MN 56763, US",
    "5080": "Sault Ste Marie Enrollment Center - 900 International Bridge Plaza, Sault Ste. Marie, MI 49783, US",
    "5100": "Pembina Enrollment Center - 10980 Interstate 29 N, Suite 2, Pembina, ND 58271, US",
    "5101": "Houlton Enrollment Center - 1403 Route 95, Belleville, NB E7M4Z9, CA",
    "5120": "Sweetgrass Enrollment Center - 39825 FAST Enrollment Center, 39825 Interstate 15 North, Sweetgrass, MT 59484, US",
    "5140": "JFK International Global Entry EC - JFK International Airport, Terminal 4, IAT, Jamaica, NY 11430, US",
    "5141": "Houston Intercontinental Global Entry EC - 3870 North Terminal Road, Terminal E, Houston, TX 77032, US",
    "5142": "Washington Dulles International Global Entry EC - 22685 International Arrivals- Main Terminal, Washington Dulles International Airport, Sterling , VA 20041, US",
    "5160": "Fort Frances Enrollment Center - 301 Scott Street, Fort Frances, ON P9A1H1, CA",
    "5161": "Niagara Falls Enrollment Center - 2250 WHIRLPOOL ST., NIAGARA FALLS, NY 14305, US",
    "5180": "Los Angeles International Global Entry EC - 380 World Way, Tom Bradley International Terminal, Los Angeles, CA 90045, US",
    "5181": "Miami International Global Entry EC - 4200 NW 21st Street, Miami International Airport, Conc. \"J\", Miami, FL 33122, US",
    "5182": "Atlanta International Global Entry EC - 2600 Maynard H. Jackson Jr. Int'l Terminal, Maynard H. Jackson Jr. Blvd., Atlanta, GA 30320, US",
    "5183": "Chicago O'Hare International Global Entry EC  - 10000 Bessie Coleman Drive, Terminal 5, Lower Level, Chicago, IL 60666, US",
    "5200": "Atlanta Port Office Global Entry Enrollment Center - 157 Tradeport Drive, Suite C, Atlanta, GA 30354, US",
    "5223": "Derby Line Enrollment Center - 107 Interstate 91 South, Derby Line, VT 08530, US",
    "5300": "Dallas-Fort Worth Intl Airport Global Entry - DFW International Airport - Terminal D, DFW Airport, TX 75261, US",
    "5320": "Detroit Metro Airport Global Entry - 601 Detroit North Terminal, Rogell Dr., Suite 1271, Detroit, MI 48242, US",
    "5340": "Honolulu Enrollment Center - 300 Rodgers Blvd, Honolulu, HI 96819, US",
    "5360": "Las Vegas Enrollment Center - 5757 Wayne Newton Blvd Terminal 3, Las Vegas, NV 89119, US",
    "5380": "Orlando Global Entry Enrollment Center - 1 Orlando International Airport, Airport Blvd, Orlando, FL 32827, US",
    "5400": "San Juan Global Entry Enrollment Center - Luis Munoz Marin Int'l Airport, Carolina, PR 00937, US",
    "5420": "SeaTac International Airport Global Entry EC - CBP Global Entry Office , SeaTac International Airport , Seattle, WA 98188, US",
    "5441": "Boston-Logan Global Entry Enrollment Center - Logan International Airport, Terminal E, East Boston, MA 02128, US",
    "5443": "Fort Lauderdale Global Entry Enrollment Center - 1800 Eller Drive Suite 104, Ft Lauderdale, FL 33316, US",
    "5444": "Newark Global Entry Enrollment Center - Newark Liberty International Airport, Terminal B - International Arrivals Area, Newark , NJ 07114, US",
    "5445": "Philadelphia Global Entry Enrollment Center - PHILADELPHIA INTL AIRPORT, TERMINAL A WEST, 3RD FLOOR, PHILADELPHIA, PA 19153, US",
    "5446": "San Francisco Global Entry Enrollment Center - San Francisco International Airport, San Francisco, CA 94128, US",
    "5447": "Sanford Global Entry Enrollment Center - 1100 Red Cleveland Blvd, Sanford, FL 32773, US",
    "5460": "San Luis Enrollment Center - 0 SLU II Global Enrollment Center, 1375 South Avenue E, San Luis, AZ 85349, US",
    "5520": "Lansdowne, ON  - 664 Highway 137, Hill Island, Lansdowne, ON K0E1L0, CA",
    "6480": "U.S. Custom House - Bowling Green - 1 BOWLING GREEN, NEW YORK, NY 10004, US",
    "6580": "American Express - New York - 0 UNAVAILABLE, NEW YORK, NY 99999, US",
    "6840": "Minneapolis - St. Paul Global Entry EC - 4300 Glumack Drive, St. Paul, MN 55111, US",
    "6880": "Charlotte-Douglas International Airport - 5501 Charlotte-Douglas International Airport, Josh Birmingham Parkway, Charlotte, NC 28208, US",
    "6920": "Doha International Airport - Hamad International Airport, Doha, QA",
    "6940": "Denver International Airport - 8400 Denver International Airport, Pena Boulevard, Denver, CO 80249, US",
    "7160": "Phoenix Sky Harbor Global Entry Enrollment Center - CBP-Global Enrollment Center, 3400 E. Sky Harbor Blvd, Terminal 4, Phoenix, AZ 85034, US",
    "7480": "Houston Term E - BOARDING PASS REQUIRED TO ENT     - Sterile Corridor requires Boarding Pass, IAH Terminal E, Houston, TX 77032, US",
    "7520": "San Antonio International Airport - 9800 Airport Boulevard, Suite 1101, San Antonio, TX 78216, US",
    "7540": "Anchorage Enrollment Center - Ted Stevens International Airport, 4600 Postmark Drive, RM NA 207, Anchorage , AK 99502, US",
    "7600": "Salt Lake City International Airport - 3850 West Terminal Dr, International Arrivals Terminal, Salt Lake City, UT 84116, US",
    "7620": "Houston Central Library - 500 McKinney St., Houston, TX 77002, US",
    "7680": "Cincinnati Enrollment Center - 4243 Olympic Blvd. Suite. 210, Erlanger, KY 41018, US",
    "7740": "Milwaukee Enrollment Center - 4915 S Howell Ave., 2nd floor, Milwaukee, WI 53207, US",
    "7820": "Austin-Bergstrom International Airport - 3600 Presidential Blvd., Austin-Bergstrom International Airport, Austin, TX 78719, US",
    "7940": "Baltimore Enrollment Center - Baltimore Washington Thurgood Marshall I, Lower Level Door 18, Linthicum, MD 21240, US",
    "7960": "Portland, OR Enrollment Center - 7000 PDX AIRPORT, Room T3352, Portland, OR 97218, US",
    "8020": "Tampa Enrollment Center - Tampa International Airport, 4100 George J Bean Outbound Pkwy, Tampa, FL 33607, US",
    "8040": "Albuquerque Enrollment Center - Albuquerque International Sunport, 2200 Sunport Blvd SE  , Albuquerque, NM 87106, US",
    "8060": "San Ysidro Enrollment Center - 795 E. SAN YSIDRO BLVD, SAN YSIDRO, CA 92173, US",
    "8100": "Douglas Enrollment Center - 1012 G Avenue Suite 107, Douglas, AZ 85607, US",
    "8120": "Washington, DC Enrollment Center - 1300 Pennsylvania Avenue NW, Washington, DC 20229, US",
    "8920": "Los Angeles -Long Beach Seaport  - 301 E. Ocean Blvd , Room 805, Long Beach, CA 90802, US",
    "9040": "Singapore, U.S. Embassy - U.S. Embassy, 27 Napier Road, Singapore, SG",
    "9101": "Grand Portage - 9403 E Highway 61, Grand Portage, MN 55605, US",
    "9140": "Guam International Airport - 355 Chalan PasaHeru, Suite B 224-B, Tamuning, GU 96913, US",
    "9180": "Cleveland U.S. Customs and Border Protection - Customs & Border Protection, 6747 Engle Road, Middleburg Heights, OH 44130, US",
    "9200": "Pittsburgh International Airport - 1000 Airport Boulevard, Ticketing Level, Pittsburgh, PA 15231, US",
    "9240": "Tucson Enrollment Center - 7150 S. Tucson Blvd, Tucson, AZ 85756, US",
    "9260": "West Palm Beach Enrollment Center - West Palm Beach Enrollment Center, 1 East 11th Street, Third Floor, Riviera Beach, FL 33404, US",
    "9300": "Warwick, RI Enrollment Center - Warwick, RI Enrollment Center, 300 Jefferson Boulevard, Suite 106, Warwick, RI 02886, US",
    "9740": "New Orleans Enrollment Center - 900 Airline Drive, Kenner, LA 70062, US",
    "10260": "Nashville Enrollment Center - 612 Hangar Lane, Suite 116, Nashville, TN 37217, US",
    "11000": "Moline Quad Cities International Airport - 3300 69th Ave, Quad Cities International Airport, Moline, IL 61265, US",
    "11001": "Rockford-Chicago International Airport - 50 Airport Drive, Chicago Rockford International Airport, Rockford, IL 61109, US",
    "11002": "Peoria International Airport - 5701 W. Smithville Road , Suite 700, Bartonville, IL 61607, US",
    "11841": "Port Clinton, Ohio Enrollment Center - 709 S.E. Catawba Road, Port Clinton, OH 43452, US",
    "11981": "Chicago Field Office Enrollment Center - 610 South Canal Street, Suite 300, Chicago, IL 60607, US",
    "12021": "St. Louis Enrollment Center - 10701 Lambert Intl Blvd, Terminal 2,  , St. Louis, MO 63145, US",
    "12101": "FOLA 051116-CT - ",
    "12103": "FOLA 061416-TS - ",
    "12161": "Boise Enrollment Center - 4655 S Enterprise Street, Boise, ID 83705, US",
    "12181": "FOLA  060716-SS - ",
    "12261": "FOLA 052016-PWC - ",
    "12341": "NEAAA - 10220 Regency Cir, , Marriott Hotel Regency, Omaha, NE 68114, US",
    "12421": "Toronto Enrollment Center AESC - 2935 Convair Road, AESC-Airport Emergency Service Center, Mississauga, ON L5P1B2, CA",
    "12441": "FOLA 051816-PT - ",
    "12501": "VSLB - ",
    "12541": "CSOTC - ",
    "12561": "FOLA 062116-LW - ",
    "12641": "FTSD - ",
    "12661": "EPIC - Private Event - Direct Invitaion Only, VERONA, WI, US",
    "12662": "KEYAIA - Appleton, WI, US",
    "12681": "GEN-ZEE  - ",
    "12701": "MAY-ACT - ",
    "12761": "FBTX - ",
    "12762": "NITX - ",
    "12781": "Kansas City Enrollment Center - 90 Beirut Circle, Terminal C, Gate 90, Kansas City, MO 64153, US",
    "12801": "IPW2016 - 900 Convention Center Blvd , New Orleans Ernest N. Morial Convention Center, New Orleans, LA, US",
    "12821": "ETLN - 1212 O street, Lincoln, NE 68508, US",
    "12822": "TTON - 16950 Wright Plaza , 151, Omaha, NE 68130, US",
    "12841": "IGEDCO - ",
    "12861": "EOP - ",
    "12901": "Oshkosh Airshow - ",
    "12921": "FOLA 071216-UC - ",
    "12941": "RDU - ",
    "12961": "Lab126 - "
};