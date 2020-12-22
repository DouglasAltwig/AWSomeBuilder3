// https://epsagon.com/development/how-to-set-up-aws-lambda-with-sqs-everything-you-should-know/
// sls invoke -f start-lambda
// sls logs -f start-lambda
// sls logs -f end-lambda
'use strict';
const axios = require('axios');
const AWS = require('aws-sdk')
const AmazonS3URI = require('amazon-s3-uri')

const REGION = process.env.REGION
const HOSTNAME = process.env.HOSTNAME
const PORT = process.env.PORT
const PATH = process.env.PATH
const TARGET_BUCKET = process.env.TARGET_BUCKET
const SQS_URL = process.env.SQS_URL

AWS.config.update({region: REGION || 'us-east-1'})

const sqs = new AWS.SQS({apiVersion: '2012-11-05'})
const s3 = new AWS.S3({apiVersion: '2006-03-01'})

module.exports.start = async (event, context) => {
  /**
   * First Lambda function. Triggered manually.
   * @param {object} event AWS event data
   * @param {object} context AWS function's context
   * @returns {undefined}
   */
  
  async function FetchData(url){
    try {
      return await axios.get(url)
    } catch (error) {
      let msg = `Unable to fetch data from: ${url}`
      console.error(msg)
      throw new Error(msg)
    }
    
  }
  function GetMediaURIs(fileUris, hostname, port){
    let uris = fileUris.map(fileUri => {
      try {
        const {region, bucket, key} = AmazonS3URI(fileUri)
        return `http://${hostname}:${port}/api/items/download/${bucket}/${key}`
      } catch (error) {
        console.warn(`${fileUri} is not a valid S3 uri`);
        throw new Error(`Could not parse the S3 uri: ${fileUri}`)
      }
    })
    return uris
  }
  async function GetMediaFiles(uris) {
    let promises = uris.map(uri => {
      return axios.get(uri, {responseType: 'arraybuffer'})
    })
    try {
      return await Promise.all(promises)  
    } catch (error) {
      let msg = `Unable to download media file(s) from: ${hostname}:${port}`
      console.error(msg)
      throw new Error(msg)
    }
  }
  async function MoveFilesToS3(responses, target_bucket) {
    let S3PutObjectPromises = []
    responses.forEach(response => {
      let params = {
        Body: response.data,
        Bucket: target_bucket,
        Key: response.config.url.split('/').pop()
      }
      S3PutObjectPromises.push(s3.putObject(params).promise())
    })
    try {
      return await Promise.all(S3PutObjectPromises)  
    } catch (error) {
      let msg = `Unable to put object in S3`
      console.error(msg)
      throw new Error(msg)
    }
  }
  async function SendMessages (items, sqs_url) {
    let messagePromises = []
    items.forEach(item => {
      let msg = {
        MessageBody: JSON.stringify(item),
        QueueUrl: sqs_url
      }
      messagePromises.push(sqs.sendMessage(msg).promise())
    })
    try {
      return await Promise.all(messagePromises)
    } catch (error) {
      let msg = `Unable to send message(s) to: ${sqs_url}`
      console.error(msg)
      throw new Error(msg)
    }
  }
  try {
    let url = `http://${HOSTNAME}:${PORT}/${PATH}`
    let response = await FetchData(url)
    let items = response.data
    let fileUris = items.map(item => item.file_path)
    let uris = GetMediaURIs(fileUris, HOSTNAME, PORT)
    let mediaFiles = await GetMediaFiles(uris)
    let etags = await MoveFilesToS3(mediaFiles, TARGET_BUCKET)
    let messageIds = await SendMessages(items, SQS_URL)
    console.log('Success')
  } catch (error) {
    console.log(error)
  }
};

module.exports.end = (event, context) => {
  /**
   * Second lambda function. Triggered by the SQS.
   * @param {object} event AWS event data (this time will be the SQS's data)
   * @param {object} context AWS function's context
   * @returns {undefined}
   */
  console.log(event)
}

// let event = {
//   Records: [{
//     messageId: 'c3af93e1-3a83-4a0f-82e8-0fe0dc23bd5e',
//     receiptHandle: 'AQEBdD2IA/7YC7llKu4QUpdZT3Eaf6yFLITlIfuvJ5bw2RQcTTgF5IpTb+4gyEuqeEI/Ek7Qa3QGfjlhanqhu4Yk0YXpGOZ3oHAuoI4m2SRp6pNiX2RJi1pCp5hyNqhjnCklGduoPK6P7sk0nfWtRxlbTwv1ePAfOSCEoOBFeCfhZhPWjooOtPa7pbhayZzDifu6nwdLOzc8H6kNoxvvUon9W48SN03GhvwFU+uBWQeHvrRcjb0eue1rNmODPsZcFm87rALcDU6Vl1iyfLsvQnYZaGWem0/syEsIFZq9+XlMuheCsIsj838+Rgqew6sN+eWlc80yesevPIav+gOO0wMIV8ivxR6BH1ftQ5ce8TDGZfbjPMP3zcvmG+vvtt8sMY+qr236WvtscADlhUlY5b0I6A==',
//     body: 'Information about current NY Times fiction bestseller for week of 12/11/2016.',
//     attributes: {
//       ApproximateReceiveCount: '1',
//       SentTimestamp: '1608138701566',
//       SenderId: 'AIDATEI6JNC5J66FDVY27',
//       ApproximateFirstReceiveTimestamp: '1608138711566'
//     },
//     messageAttributes: {
//       WeeksOn: {
//         stringValue: '6',
//         stringListValues: [],
//         binaryListValues: [],
//         dataType: 'Number'
//       },
//       Author: {
//         stringValue: 'John Grisham',
//         stringListValues: [],
//         binaryListValues: [],
//         dataType: 'String'
//       },
//       Title: {
//         stringValue: 'The Whistler',
//         stringListValues: [],
//         binaryListValues: [],
//         dataType: 'String'
//       }
//     },
//     md5OfMessageAttributes: 'd25a6aea97eb8f585bfa92d314504a92',
//     md5OfBody: 'bbdc5fdb8be7251f5c910905db994bab',
//     eventSource: 'aws:sqs',
//     eventSourceARN: 'arn:aws:sqs:us-east-1:215348766906:ModerationQueue',
//     awsRegion: 'us-east-1'
//   }]
// }

