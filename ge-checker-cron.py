#!/usr/bin/python

# Note: for setting up email with sendmail, see: http://linuxconfig.org/configuring-gmail-as-sendmail-email-relay

from subprocess import check_output
from datetime import datetime
from os import path
import sys, smtplib, json

PWD = path.dirname(sys.argv[0]) 

# Get settings
try:
    with open('%s/config.json' % PWD) as json_file:    
        settings = json.load(json_file)
except Exception as e:
    print 'Error extracting config file: %s' % e
    sys.exit()

# Make sure we have all our settings
if not 'current_interview_date_str' in settings or not settings['current_interview_date_str']:
    print 'Missing current_interview_date_str in config'
    sys.exit()
if not 'email_from' in settings or not settings['email_from']:
    print 'Missing from address in config'
    sys.exit()
if not 'email_to' in settings or not settings['email_to']:
    print 'Missing to address in config'
    sys.exit()
if not 'init_url' in settings or not settings['init_url']:
    print 'Missing initial URL in config'
    sys.exit()
if not 'enrollment_location_ids' in settings or not settings['enrollment_location_ids']:
    print 'Missing enrollment_location_ids in config'
    sys.exit()
if not 'username' in settings or not settings['username']:
    print 'Missing username in config'
    sys.exit()
if not 'password' in settings or not settings['password']:
    print 'Missing password in config'
    sys.exit()

CURRENT_INTERVIEW_DATE = datetime.strptime(settings['current_interview_date_str'], '%B %d, %Y')

def log(msg):
    print msg

    if not 'logfile' in settings or not settings['logfile']: return
    with open(settings['logfile'], 'a') as logfile:
        logfile.write('%s: %s\n' % (datetime.now(), msg))

def send_apt_available_email(current_apt, avail_apt):
    message = """From: %s
To: %s
Subject: Alert: New Global Entry Appointment Available
Content-Type: text/html

<p>Good news! There's a new Global Entry appointment available on <b>%s</b> (your current appointment is on %s).</p>

<p>If this sounds good, please sign in to https://goes-app.cbp.dhs.gov/main/goes to reschedule.</p>

<p>If you reschedule, please remember to update CURRENT_INTERVIEW_DATE in your config.json file.</p>
""" % (settings['email_from'], ', '.join(settings['email_to']), avail_apt.strftime('%B %d, %Y'), current_apt.strftime('%B %d, %Y'))

    try:
        server = smtplib.SMTP('localhost')
        server.sendmail(settings['email_from'], settings['email_to'], message)
        server.quit()
    except Exception as e:
        log('Failed to send success email')


# TODO: handle new multi-locatino output
# it currently looks something like this
    # {"date":"January 2, 2017","location_id":"5441","msg":"report-interview-time","location_name":"Boston-Logan Global Entry Enrollment Center - ... "}
    # {"date":"June 24, 2016","location_id":"5444","msg":"report-interview-time","location_name":"Newark Global Entry Enrollment Center - ... "}
    # {"date":"June 28, 2016","location_id":"5140","msg":"report-interview-time","location_name":"JFK International Global Entry EC -... "}
    # {"date":"November 11, 2016","location_id":"5446","msg":"report-interview-time","location_name":"San Francisco Global Entry Enrollment Center -  ..."}
    # {"date":"August 9, 2016","location_id":"9740","msg":"report-interview-time","location_name":"New Orleans Enrollment Center - ... "}
new_apt_str = check_output(['phantomjs', '%s/ge-cancellation-checker.phantom.js' % PWD]); # get string from PhantomJS script - formatted like 'July 20, 2015'
new_apt_str = new_apt_str.strip()

# try: new_apt = datetime.strptime(new_apt_str, '%B %d, %Y')
# except ValueError as e:
#     log('%s' % new_apt_str)
#     sys.exit()

# if new_apt < CURRENT_INTERVIEW_DATE: # new appointment is newer than existing!
send_apt_available_email(CURRENT_INTERVIEW_DATE, new_apt)   
log('Found appointments on %s (current is on %s)!' % (new_apt, CURRENT_INTERVIEW_DATE))
# else:
#     log('No new appointments. Next available on %s (current is on %s)' % (new_apt, CURRENT_INTERVIEW_DATE))
