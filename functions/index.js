const admin = require('firebase-admin');
const functions = require('firebase-functions');
const request = require('request');
const md5 = require('md5');

// Initialize the default app
admin.initializeApp(functions.config().firebase);

var db = admin.firestore();


//Parse out JSON encoded string without exec
/*
var key = JSON.parse('{ "value" : "' + functions.config().fb.key + '" }').value;

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: 'openactive-live',
    clientEmail: 'firebase-adminsdk-2mgoh@openactive-live.iam.gserviceaccount.com',
    privateKey: key
  }),
  databaseURL: 'https://openactive-live.firebaseio.com'
});
*/

var MAILCHIMP_LIST_ID = "1665f95799";

var PUBLISHING_INTEREST = '7c0bbf4e53'
var USING_INTEREST = '6e43f35f7d'
var IMPLEMENTING_INTEREST = 'afbd2ab9e8'
var SPREADING_INTEREST = 'caf2a7e34c'
var STANDARDS_INTEREST = '432e7add9a'


function updateMailingList(fname, lname, org, phone, email, publishing, using, implementing, spreading, standards) {

    //MD5 of e-mail address
    var md5id = md5(email.toLowerCase()); 
    
    //Merge fields
    var bodyPut = {
      "email_address": email,
      "merge_fields": {},
      "interests": {},
      "status_if_new": "subscribed"
    }
    
    if (fname) bodyPut["merge_fields"]["FNAME"] = fname;
    if (lname) bodyPut["merge_fields"]["LNAME"] = lname;
    if (org) bodyPut["merge_fields"]["ORG"] = org;
    if (phone) bodyPut["merge_fields"]["PHONE"] = phone;

    bodyPut["interests"][PUBLISHING_INTEREST] = publishing || false;
    bodyPut["interests"][USING_INTEREST] = using || false;
    bodyPut["interests"][IMPLEMENTING_INTEREST] = implementing || false;
    bodyPut["interests"][SPREADING_INTEREST] = spreading || false;
    bodyPut["interests"][STANDARDS_INTEREST] = standards || false;

    return request({
      method: 'PUT',
      url: 'https://us13.api.mailchimp.com/3.0/lists/' + MAILCHIMP_LIST_ID + '/members/' + md5id,
      headers: {
        'Authorization': 'apikey ' + functions.config().mailchimp.key
      },
      json: true,
      body: bodyPut
    }, (err, res, body) => {
      if (err) {
        console.error('error posting json: ', err)
        throw err
      }
      var headers = res.headers
      var statusCode = res.statusCode
      console.log('statusCode: ', statusCode)
      if (statusCode >= 400) console.log('errorBody: ', body)
      return res.statusCode;
    });
}


function removeFromMailingList(email) {

    //MD5 of e-mail address
    var md5id = md5(email.toLowerCase()); 

    return request({
      method: 'DELETE',
      url: 'https://us13.api.mailchimp.com/3.0/lists/' + MAILCHIMP_LIST_ID + '/members/' + md5id,
      headers: {
        'Authorization': 'apikey ' + functions.config().mailchimp.key
      }
    }, (err, res, body) => {
      if (err) {
        console.error('error posting json: ', err)
        throw err
      }
      var headers = res.headers
      var statusCode = res.statusCode
      console.log('statusCode: ', statusCode)
      if (statusCode >= 400) console.log('errorBody: ', body)
      return res.statusCode;
    });

}

function refreshBookingSystemCount(system) {
  var votes = db.collection("organisations").where("booking-system", "==", system).get().then(votes => {
    console.log(votes.size);
    return db.collection("bookingsystems").doc(system).set({
      votes: votes.size
    });
  }).catch(error => {
    console.log("Booking count error: " + error)
  });
}

function refreshBookingSystemCounts(...systems) {
  for (i = 0; i < systems.length; i++) { 
      if (systems[i]) refreshBookingSystemCount(systems[i]);
  }
}

exports.modifyUser = functions.firestore
    .document('users/{userID}')
    .onWrite((change, context) => {

      var userID = context.params.userID;

      // Get an object with the previous document value (for update or delete)
      const oldDocument = change.before.data();

      // Get an object with the current document value.
      // If the document does not exist, it has been deleted.
      const newDocument = change.after.exists ? change.after.data() : null;

      //If deleted then unsubscribe, regardless of if the user exists or not (to prevent race conditions)
      if (change.before.exists && (!change.after.exists || oldDocument.email !== newDocument.email || !newDocument['mailing'])) {
        if (oldDocument.email) {
          return removeFromMailingList(oldDocument.email);
        } else {
          return false;
        }
      } 

      if ( (oldDocument["user-booking-system"] || "") !== (newDocument["user-booking-system"] || "") ) {
        refreshBookingSystemCounts(oldDocument["user-booking-system"], newDocument["user-booking-system"])
      } else {
        refreshBookingSystemCounts(newDocument["user-booking-system"])
      }

      //Only register for mailing list if they've ticked the box
      if (newDocument && newDocument['mailing']) {
        admin.auth().getUser(userID)
          .then(userRecord => {
            if (userRecord.emailVerified) {
              console.log("Updating mailing list");
              return updateMailingList(
                newDocument['first-name'], 
                newDocument['last-name'], 
                newDocument['organisation'], 
                newDocument['phone'], 
                newDocument['email'], 
                newDocument['publishing'] || false, //publishing
                newDocument['using'] || false, //using
                newDocument['implementing'] || false, //implementing
                newDocument['spreading'] || false, //spreading
                newDocument['standards'] || false //standards
              );
            } else {
              // Do nothing if the e-mail is not verified
              return false;
            }
          }).catch(error => {
            console.log("Error fetching user data:", error);
          }) 
      }

      return true;
    });

