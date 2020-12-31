'use strict';

const axios = require('axios')
const AWS = require('aws-sdk')
const s3 = new AWS.S3({apiVersion: '2006-03-01'})
const rekognition = new AWS.Rekognition({apiVersion: '2016-06-27'})
const dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10'})
const AmazonS3URI = require('amazon-s3-uri')

function search(needle, haystack, found = []) {
  Object.keys(haystack).forEach((key) => {
    if(key === needle){
      found.push(haystack[key])
      return found
    }
    if(typeof haystack[key] === 'object'){
      search(needle, haystack[key], found)
    }
  })
  return found
}

module.exports.checkfordrugs = async (event, context) => {
  const DRUGS_NAME_CONFIDENCE = process.env.DRUGS_NAME_CONFIDENCE
  if (DRUGS_NAME_CONFIDENCE === undefined) {
    throw new Error('No DRUGS_NAME_CONFIDENCE environment variable is set.')
  }

  try {
    var drugsObj = JSON.parse(DRUGS_NAME_CONFIDENCE)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`An error occurred while parsing the evironment variable 'DRUGS_NAME_CONFIDENCE': ${DRUGS_NAME_CONFIDENCE}`)
  }
  
  try {
    var fileUri = event.item.file_path
    var {region, bucket, key} = AmazonS3URI(fileUri)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`${fileUri} is not a valid S3 URI`)
  }

  try {
    let params = {Image: {S3Object: {Bucket: bucket, Name: key}}}
    // console.log('Making inference using Rekognition:')
    let labels = await rekognition.detectLabels(params).promise()
    // console.log(JSON.stringify(inference, null, 4))
    let labelNames = search('Name', labels)
    let uniqLabelNames = [...new Set(labelNames)]
    // console.log(uniqInferenceKeywords)
    let drugsNames = Object.keys(drugsObj)
    // console.log(drugsKeywords)
    let result = drugsNames.filter(v => uniqLabelNames.includes(v))
    // console.log(result)
    return {item: event.item, labels: labels, length: result.length}
  } catch (error) {
    console.log(error, error.stack)
    throw new Error('Unable to communicate with AWS Rekognition')
  }
}

module.exports.checkforfirearm = async (event, context) => {
  const GUNS_NAME_CONFIDENCE = process.env.GUNS_NAME_CONFIDENCE
  if (GUNS_NAME_CONFIDENCE === undefined) {
    throw new Error('No GUNS_NAME_CONFIDENCE environment variable is set.')
  }

  try {
    var gunsObj = JSON.parse(GUNS_NAME_CONFIDENCE)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`An error occurred while parsing the evironment variable 'GUNS_NAME_CONFIDENCE': ${GUNS_NAME_CONFIDENCE}`)
  }
  
  try {
    let fileUri = event.item.file_path
    var {region, bucket, key} = AmazonS3URI(fileUri)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`${fileUri} is not a valid S3 URI`)
  }

  if (event.labels) {
    let labelNames = search('Name', event.labels)
    let uniqLabelNames = [...new Set(labelNames)]
    let gunsNames = Object.keys(gunsObj)
    let result = gunsNames.filter(v => uniqLabelNames.includes(v))
    return {item: event.item, labels: event.labels, length: result.length}
  }

  try {
    let params = {Image: {S3Object: {Bucket: bucket, Name: key}}}
    // console.log('Making inference using Rekognition:')
    let labels = await rekognition.detectLabels(params).promise()
    // console.log(JSON.stringify(inference, null, 4))
    let labelNames = search('Name', labels)
    let uniqLabelNames = [...new Set(labelNames)]
    // console.log(uniqInferenceKeywords)
    let gunsNames = Object.keys(gunsObj)
    // console.log(drugsKeywords)
    let result = gunsNames.filter(v => uniqLabelNames.includes(v))
    // console.log(result)
    return {item: event.item, labels: labels, length: result.length}
  } catch (error) {
    console.log(error, error.stack)
    throw new Error('Unable to communicate with AWS Rekognition')
  }
}

module.exports.foundsomething = async (event, context) => {
  const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE
  if (DYNAMODB_TABLE === undefined) {
    throw new Error('No DYNAMODB_TABLE environment variable is set.')
  }
  
  let clonedEvent = JSON.parse(JSON.stringify(event))
  clonedEvent.id = event.item.id
  var marshalled = AWS.DynamoDB.Converter.marshall(clonedEvent)
  
  try {
    var params = {
      Item: marshalled,
      ReturnConsumedCapacity: "TOTAL",
      TableName: DYNAMODB_TABLE
    }
    let response = await dynamodb.putItem(params).promise()
    console.log('DynamoDB PutItem Response:')
    console.log(response)
    // return response
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`An error occurred while trying to persist the following parameters: ${params}`)
  }
}

module.exports.foundnothing = async (event, context) => {
  const HOSTNAME = process.env.HOSTNAME
  if (HOSTNAME === undefined) {
    throw new Error('No HOSTNAME environment variable is set.')
  }
  
  const PORT = process.env.PORT
  if (PORT === undefined) {
    throw new Error('No PORT environment variable is set.')
  }

  try {
    let fileUri = event.item.file_path
    var {region, bucket, key} = AmazonS3URI(fileUri)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`${fileUri} is not a valid S3 URI`)
  }

  try {
    let url = `http://${HOSTNAME}:${PORT}/api/items/${event.item.id}`
    let response = await axios.put(url, {status: 'approved'})
    console.log(response.data.message)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to update item with id: ${event.item.id}`)
  }
  
  try {
    let params = {Bucket: bucket, Key: key}
    let response = await s3.deleteObject(params).promise()
    console.log(JSON.stringify(response, null, 4))
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to delete object from S3 bucket: ${bucket}/${key}`)
  }
}


module.exports.streamfunction = async (event, context) => {
  const HOSTNAME = process.env.HOSTNAME
  if (HOSTNAME === undefined) {
    throw new Error('No HOSTNAME environment variable is set.')
  }
  
  const PORT = process.env.PORT
  if (PORT === undefined) {
    throw new Error('No PORT environment variable is set.')
  }

  let itemUpdatePromises = []
  let itemIds = []
  event.Records.forEach(record => {
    if (record.dynamodb.NewImage) {
      let unmarshalled = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage)
      let id = unmarshalled.id
      let params = {status: "escalated"}
      let url = `http://${HOSTNAME}:${PORT}/api/items/${id}`
      itemIds.push(id)
      itemUpdatePromises.push(axios.put(url, params))
    }
  })

  try {
    let reponses = await axios.all(itemUpdatePromises)
    responses.forEach(response => {
      console.log(response.status, response.config.url, response.data)
    })
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to update the following item ID(s): ${itemIds}`)
  }
}