import {prepareAbsenceStage,verifyAbsenceStage} from '../src/absence-preparation.js';
console.log(JSON.stringify(process.argv[2]?verifyAbsenceStage(process.argv[2]):prepareAbsenceStage()));
