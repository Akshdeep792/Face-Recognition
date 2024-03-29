'use strict';

const msRest = require("@azure/ms-rest-js");
const Face = require("@azure/cognitiveservices-face");
const { v4: uuid } = require('uuid');

const key = "a57406cbdb8e4813a81eef794af43319";
const endpoint = "https://face-recogntion.cognitiveservices.azure.com/";

const credentials = new msRest.ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': key } });
const client = new Face.FaceClient(credentials, endpoint);


const image_base_url = "https://raw.githubusercontent.com/Akshdeep792/Securing-Online-Transaction/master/";
const person_group_id = uuid();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function DetectFaceRecognize(url) {
    // Detect faces from image URL. Since only recognizing, use the recognition model 4.
    // We use detection model 3 because we are only retrieving the qualityForRecognition attribute.
    // Result faces with quality for recognition lower than "medium" are filtered out.
    let detected_faces = await client.face.detectWithUrl(url,
        {
            detectionModel: "detection_03",
            recognitionModel: "recognition_04",
            returnFaceAttributes: ["QualityForRecognition"]
        });
    return detected_faces.filter(face => face.faceAttributes.qualityForRecognition == 'high' || face.faceAttributes.qualityForRecognition == 'medium');
}

async function AddFacesToPersonGroup(person_dictionary, person_group_id) {
    console.log ("Adding faces to person group...");
    // The similar faces will be grouped into a single person group person.
    
    await Promise.all (Object.keys(person_dictionary).map (async function (key) {
        const value = person_dictionary[key];

        // Wait briefly so we do not exceed rate limits.
        await sleep (2000);

        let person = await client.personGroupPerson.create(person_group_id, { name : key });
        console.log("Create a persongroup person: " + key + ".");

        // Add faces to the person group person.
        await Promise.all (value.map (async function (similar_image) {
            // Check if the image is of sufficent quality for recognition.
            let sufficientQuality = true;
            let detected_faces = await client.face.detectWithUrl(image_base_url + similar_image,
                {
                    returnFaceAttributes: ["QualityForRecognition"],
                    detectionModel: "detection_03",
                    recognitionModel: "recognition_03"
                });
            detected_faces.forEach(detected_face => {
                if (detected_face.faceAttributes.qualityForRecognition != 'high'){
                    sufficientQuality = false;
                }
            });

            // Quality is sufficent, add to group.
            if (sufficientQuality){
                console.log("Add face to the person group person: (" + key + ") from image: " + similar_image + ".");
                await client.personGroupPerson.addFaceFromUrl(person_group_id, person.personId, image_base_url + similar_image);
            }
        }));
    }));

    console.log ("Done adding faces to person group.");
}

async function WaitForPersonGroupTraining(person_group_id) {
    // Wait so we do not exceed rate limits.
    console.log ("Waiting 10 seconds...");
    await sleep (10000);
    let result = await client.personGroup.getTrainingStatus(person_group_id);
    console.log("Training status: " + result.status + ".");
    if (result.status !== "succeeded") {
        await WaitForPersonGroupTraining(person_group_id);
    }
}

/* NOTE This function might not work with the free tier of the Face service
because it might exceed the rate limits. If that happens, try inserting calls
to sleep() between calls to the Face service.
*/
async function IdentifyInPersonGroup() {
    console.log("========IDENTIFY FACES========");
    console.log();

// Create a dictionary for all your images, grouping similar ones under the same key.
    const person_dictionary = {
        "Aksh" : ["Aksh12.jpg"]
    };

    // A group photo that includes some of the persons you seek to identify from your dictionary.
    //let source_image_file_name = "identification1.jpg";
    let source_image_file_name = "https://sercuma.com/img/1653294471.png";

    
    // Create a person group. 
    console.log("Creating a person group with ID: " + person_group_id);
    await client.personGroup.create(person_group_id, person_group_id, {recognitionModel : "recognition_04" });

    await AddFacesToPersonGroup(person_dictionary, person_group_id);

    // Start to train the person group.
    console.log();
    console.log("Training person group: " + person_group_id + ".");
    await client.personGroup.train(person_group_id);

    await WaitForPersonGroupTraining(person_group_id);
    console.log();

    // Detect faces from source image url and only take those with sufficient quality for recognition.
    let face_ids = (await DetectFaceRecognize( source_image_file_name)).map (face => face.faceId);
    // let face_ids = (await DetectFaceRecognize(image_base_url + source_image_file_name)).map (face => face.faceId);
    // Identify the faces in a person group.
    let results = await client.face.identify(face_ids, { personGroupId : person_group_id});
    await Promise.all (results.map (async function (result) {
        if(result.candidates.length == 0)
        {
        console.log("Invalid image.. Cannot find matching image");
        }
        else{
        let person = await client.personGroupPerson.get(person_group_id, result.candidates[0].personId);
        console.log("Person: " + person.name + " is identified for face in: " + source_image_file_name + " with ID: " + result.faceId + ". Confidence: " + result.candidates[0].confidence + ".");
        }
    }));
    console.log();
}

async function main() {
    await IdentifyInPersonGroup();
    console.log ("Done.");
}
main();