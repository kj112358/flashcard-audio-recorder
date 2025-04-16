const RecordRTC = require('recordrtc');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const readline = require('readline');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { ipcRenderer, clipboard } = require('electron');
const logger = require('./logger');

let sideEnum = {
  0: "front",
  1: "back"
};

let flashCardElementId = "flashcard";
let counterDiv;
let listenButton;

let recorder;
let backCardDelim = "\t";

let audioElement = new Audio();
let audioPathSettings = {
  getDir: generateAudioPath,
  filePrefix: "",
  formatType: ".wav"
};
let audioPrefix = "sound:";

// Init vars
let baseDir;
let configFilePath;
let prevAudioDir;
let importFilePath;
let importFileType;
let currentCard;
let userConfig;
let currentIndex;
let lastCheckedIndex = -1;
let celebrated;
let flashcards;
let side;
let flashcardTextId = "flashcard";
let flashcardInputID = "flashcard-edit";
let flashInput;
let flashText;
let counterTextId = "currentFlashcardIndex";
let counterInputID = "currentFlashcardIndex-edit";
let counterText;
let counterInput;
let modal;
let closeModalButton;

let defaultListenText = "Listen";
let defaultRecordText = "Start Recording";
let defaultImportExportFile = "flashcards justinRIsGr8.txt";

function processUserConfig() {
  // Create an empty config file if config doesn't exist already.
  if (!fs.existsSync(configFilePath)) {
    fs.writeFileSync(configFilePath, '');
  }
  userConfig = readConfig();
  logger.debug(`read userConfig: ${userConfig}`);
  if (!userConfig || userConfig.length <= 0) {
    userConfig = {
      listenAfterRecord: true,
      listenAfterLoad: false,
      recentImportPath: defaultImportExportFile,
      recentIndex: 0,
      recentSide: 0
    }
  }
  ipcRenderer.send('update-on-preference', userConfig);
  logger.debug(`final userConfig: ${JSON.stringify(userConfig)}`);
}

function generateAudioPath() {
  logger.debug(`generated audio path: ${prevAudioDir}`);
  return prevAudioDir;
}

async function electronGetConfigPath() {
  const configPath = await ipcRenderer.invoke('get-config-path');
  console.log('Config Path:', configPath);
  // Create directories if they do not exist
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(configPath, { recursive: true });
  }
  return configPath;
}

async function electronGetDataPath() {
  const dataPath = await ipcRenderer.invoke('get-data-path');

  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
  }
  console.log('Data Path:', dataPath);
  return dataPath;
}

function electronEditText() {
  toggleEdit();
}

async function electronUpdatePreferences(data) {
  logger.debug(`update prefs called. Data: ${JSON.stringify(data, null, 2)} Initial config ${JSON.stringify(userConfig, null, 2)}`);
  // Copy all relevant preferences from data to userConfig (relevant means existsInUserConfig). 
  Object.keys(data).forEach(function (key) {
    logger.debug(`data key ${key}`);
    if (key in userConfig) {
      userConfig[key] = data[key];
    }
  });

  logger.debug(`update prefs finished. Userconfig: ${JSON.stringify(userConfig, null, 2)}`);
  exportFile('config');
  return userConfig; // Return the updated target object
}

function electronCopyTextToClipboard() {
  const textItem = document.getElementById(flashCardElementId);
  logger.info('Copy text');
  console.log('Cons Copy text');

  if (textItem) {
    const textToCopy = textItem.innerText || textItem.value;
    clipboard.writeText(textToCopy);
    logger.debug('Copied text:', textToCopy);
  } else {
    logger.debug(`Error: ${flashCardElementId} not found.`);
  }
}

function getFormattedDate() {
  // Returns formatted date: 'yyyy-mm-dd_HH-MM-SS'
  let currentDate = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return `_${currentDate.getFullYear()}-${pad(currentDate.getMonth() + 1)}-${pad(currentDate.getDate())}`
    + `_${pad(currentDate.getHours())}-${pad(currentDate.getMinutes())}-${pad(currentDate.getSeconds())}`;
}

function removeFormattedDate(originalString) {
  // TODO: Still not the cleanest removal option, but I suppose it works for now. 
  let pattern = /_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/i; // YYYY-MM-DD_HH-MM-SS
  let formattedDate = originalString.match(pattern);
  return removeAfterLastDelim(originalString, formattedDate);
}

function removeAfterFirstDelim(originalString, firstDelim) {
  const firstIndex = originalString.indexOf(firstDelim);
  if (firstIndex === -1) {
    return originalString;
  }
  return originalString.substring(0, firstIndex);
}

function removeAfterLastDelim(originalString, lastDelim) {
  const lastIndex = originalString.lastIndexOf(lastDelim);
  if (lastIndex === -1) {
    return originalString;
  }
  return originalString.substring(0, lastIndex);
}

function unzipFile(zipFilePath, outputDir) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipFilePath)
      .pipe(unzipper.Extract({ path: outputDir }))
      .on('close', () => {
        logger.info(`Successfully unzipped ${zipFilePath} to ${outputDir}`);
        resolve();
      })
      .on('error', (err) => {
        logger.error(`Error unzipping file: ${err}`);
        reject(err);
      });
  });
}

function findFirstTextOrCsvFile(directoryPath) {
  try {
    // Read the directory contents synchronously
    const files = fs.readdirSync(directoryPath);

    // Filter for .txt and .csv files
    for (const file of files) {
      const fullPath = path.join(directoryPath, file);
      const ext = path.extname(file).toLowerCase();

      // Check if the current item is a file
      if (fs.statSync(fullPath).isFile()) {
        if (ext === '.txt' || ext === '.csv') {
          return fullPath; // Return the first found file
        }
      }
      // If it's a directory, search recursively
      else if (fs.statSync(fullPath).isDirectory()) {
        const result = findFirstTextOrCsvFile(fullPath);
        if (result) {
          return result; // Return the found file from the recursive call
        }
      }
    }

    return null;
  } catch (err) {
    console.error('Error reading directory:', err);
    return null;
  }
}


async function electronImport() {
  logger.info('Selecting Import file path:');
  let filePath = await ipcRenderer.invoke('dialog:open');
  const supportedFileTypes = ['.txt', '.csv', '.zip'];
  logger.info('Selected Import file path:', filePath);

  if (!filePath) {
    logger.error(`Import failed due to a missing filePath`);
    return;
  }

  filePath = filePath[0];
  if (path.extname(filePath).toLowerCase() === '.zip') {
    let zipOutputName = 'extractedZip_' + path.basename(filePath, path.extname(filePath));
    let zippedOutputPath = path.join(baseDir, zipOutputName);
    let newFilePath;
    unzipFile(filePath, zippedOutputPath)
      .then(() => {
        newFilePath = findFirstTextOrCsvFile(zippedOutputPath);
        logger.debug(`unzipped- import filePath ${newFilePath}`);
        importFile(newFilePath);
      })
      .catch((error) => {
        console.error('Failed to read ZIP file contents:', error);
      });
  } else if (supportedFileTypes.includes(path.extname(filePath).toLowerCase())) {
    importFile(filePath);
  } else {
    logger.error(`Import failed due to unsupported fileType: ${fileType}. Valid import types are ${supportedFileTypes}`);
  }
}

async function importFile(filePath) {
  if (!filePath) {
    logger.error(`Import failed due to a missing filePath`);
    return;
  }
  await init(load = false);

  importFilePath = filePath; // '/Docs/filename.txt'
  prevAudioDir = path.dirname(importFilePath);
  importFileType = importFilePath.split('.').at(-1);
  logger.debug(`importFilePath ${importFilePath} importFileType ${importFileType} prevAudioDir ${prevAudioDir}`);
  let importFileName = path.parse(importFilePath).name;
  let existingImportDir = path.join(baseDir, importFileName);
  let existingFilePath = path.join(existingImportDir, path.basename(importFilePath));
  let newFileNameNoExt = removeFormattedDate(removeAfterFirstDelim(importFileName, `.${importFileType}`)) + getFormattedDate(); // /filename_yyyy-mm-dd_HH-MM-SS
  let newFileName = `${newFileNameNoExt}.${importFileType}`;
  let localImportDir = path.join(baseDir, newFileNameNoExt); // '/ElectronRecorder/filename_yyyy-mm-dd_HH-MM-SS'
  let newFilePath = path.join(localImportDir, newFileName); // // '/ElectronRecorder/filename_yyyy-mm-dd_HH-MM-SS/filename_yyyy-mm-dd_HH-MM-SS.txt'
  logger.debug(`importFileName ${importFileName}`);
  logger.debug(`baseDir ${baseDir} newFileNameNoExt ${newFileNameNoExt} localimportDir ${localImportDir} newFileName ${newFileName}`);
  logger.debug(`input dir ${baseDir}, importFilePath: ${importFilePath}, newFileNameNoExt: ${newFileNameNoExt}, newFilePath: ${newFilePath}`);
  // Create and copy over the importFile if there isn't an existing directory with a matching file.
  // Note: The file and dirName currently have a unique timestamp attached. 
  // This means that importing will always create a new directory unless it's imported from within the local directory.
  if (!fs.existsSync(existingImportDir) || !filesMatch(importFilePath, existingFilePath)) {
    logger.debug("Directory doesn't exist or the local file differs. Creating a new dir which contains a copy of the import file");
    createDirCopyFile(localImportDir, importFilePath, newFileName);
    importFilePath = newFilePath;
  } else {
    logger.info(`Directory and file already exists. Importing local file ${existingFilePath}`);
    importFilePath = existingFilePath;
  }

  loadFlashcards();
  exportFile('config');
}

async function electronExportFile() {
  const filters = [{ name: 'Zip file', extensions: ['zip'] }];
  const defaultFileName = `${path.parse(importFilePath).name}.zip`;
  const exportPath = await ipcRenderer.invoke('dialog:save', { defaultFileName, filters });
  if (!exportPath) {
    return;
  }

  logger.debug(`fname: ${defaultFileName} filters ${JSON.stringify(filters)}`);
  let exportParentDir = path.dirname(exportPath);
  let exportFileName = path.basename(exportPath);
  const sourceDir = path.dirname(importFilePath) === '.' ? __dirname : path.dirname(importFilePath);
  logger.info(`Selected Export file parentDir: ${exportParentDir} from sourceDir ${sourceDir} with filename ${exportFileName}`);
  // zipping dir '/a/b/c': /a/b/c.zip is fine, /a/b/c/c.zip is invalid, as the output zip is within the input zip dir.
  if (exportParentDir.includes(sourceDir)) {
    logger.error("Can't zip a folder into itself. Please zip to a different dir.");
  } else {
    let zipDetails = { dir: exportParentDir, name: exportFileName }
    exportToZip(sourceDir, zipDetails)
  }
}

function filesMatch(file1Path, file2Path) {
  try {
    const file1Contents = fs.readFileSync(file1Path);
    const file2Contents = fs.readFileSync(file2Path);
    return Buffer.compare(file1Contents, file2Contents) === 0;
  } catch (err) {
    logger.debug(`Error comparing import files ${err}`);
    return false;
  }
}

function createDirCopyFile(newDirectory, originalFilePath, newFileName = path.basename(originalFilePath)) {
  // Create a local dir, with the importFileName, if it doesn't already exist
  logger.debug(`creating Dir ${newDirectory}`);
  try {
    fs.mkdirSync(newDirectory, { recursive: true });
    logger.debug(`Dir created: ${newDirectory}`);
  } catch (err) {
    if (err.code === 'EEXIST') {
      logger.error(`Dir '${newDirectory}' already exists.`);
    } else {
      logger.error(`Error creating Dir: ${err.message}`);
      return;
    }
  }
  // Copy the importFile into the new local dir.
  try {
    const destinationFilePath = path.join(newDirectory, newFileName);
    logger.debug(`copying file from ${originalFilePath} TO ${destinationFilePath}`);
    fs.copyFileSync(originalFilePath, destinationFilePath);
    logger.debug(`Copy completed to ${destinationFilePath}`);
  } catch (err) {
    console.error(`Error copying file: ${err.message}`);
    return;
  }
}

async function exportToZip(inputDir, zipDetails) {
  const outputDir = zipDetails.dir;
  const outputPath = path.join(outputDir, zipDetails.name);
  const output = fs.createWriteStream(outputPath);
  logger.debug(`outputdir ${outputDir} outputPath ${outputPath} zipFileName ${zipDetails.name}`);
  output
    .on('close', () => {
      logger.info('ZIP file has been created successfully:', outputPath);
    })
    .on('error', (err) => {
      logger.error('Error writing ZIP file:', err);
    });

  const archive = archiver('zip', {
    zlib: { level: 9 }, // Maximum compression
  });
  archive.on('error', (err) => {
    logger.error('Error creating zip file:', err);
  });
  // Pipe the archive data to the output stream
  archive.pipe(output);
  const parentDir = path.basename(inputDir);
  // Add the contents of the input directory to the archive
  archive.directory(inputDir, parentDir);
  logger.debug('finalizing archive');

  // Finalize the archive (this will trigger the writing process)
  await archive.finalize(); // Ensure the archive is finalized
}

function writeUserConfig(data) {
  try {
    const jsonData = JSON.stringify(data, null, 2); // Pretty print with 2 spaces
    logger.debug(`Writing configFile ${configFilePath} with data ${jsonData}`);
    fs.writeFileSync(configFilePath, jsonData);
    logger.info('Configuration written to file:', configFilePath);
  } catch (error) {
    logger.error('Error writing config file:', error.message);
  }
}

// Read from the config jSON file (creates an empty config file if one doesn't exist)
function readConfig() {
  try {
    const jsonData = fs.readFileSync(configFilePath, 'utf8');
    const data = JSON.parse(jsonData);
    logger.info('Configuration read from file:', data);
    return data;
  } catch (error) {
    logger.error('Error reading config file:', error);
    return null;
  }
}

function exportFile(exportType = "txt") {
  if (exportType == "config") {
    // Persist userConfig, including the most recent input path (bad practice having hidden config settings?).
    logger.debug(`configFile ${configFilePath}`);
    // Save the current state to the config file (current path, flashcard#, side)
    userConfig.recentImportPath = importFilePath;
    userConfig.recentIndex = currentIndex;
    userConfig.recentSide = side;
    ipcRenderer.send('update-listenAfterLoad-preference', userConfig);
    writeUserConfig(userConfig);
    return;
  }
  if (exportType == "txt") {
    // Convert array of JSON objects into the desired format
    const lines = flashcards.map(card => {
      const front = card.front;
      const frontAudio = front.audioFileName ? `[${audioPrefix}${front.audioFileName}]` : "";
      const back = card.back;
      const backAudio = back.audioFileName ? `[${audioPrefix}${back.audioFileName}]` : "";
      logger.info(`Writing frontaudioName ${front.audioFileName} backAudioName: ${back.audioFileName}`);
      logger.info(`Writing frontAudio ${frontAudio}, backAudio ${backAudio}`);
      return `${front.text}${frontAudio}\t${back.text}${backAudio}`;
    });
    logger.info(`Writing lines ${lines}`);

    // Join the lines with a newline character and write to a text file
    try {
      fs.writeFileSync(importFilePath, lines.join('\n'));
      logger.info('File exported successfully');
    } catch (err) {
      logger.error('Error exporting to file:', err);
    }
  }
  else {
    logger.debug(`unsupported export type: ${exportType}`);
  }
}

function deleteAudioFile(oldAudioFilePath) {
  logger.info(`deleting ${oldAudioFilePath} and replacing it with a new audio file.`);
  try {
    if (fs.existsSync(oldAudioFilePath)) {
      fs.unlinkSync(oldAudioFilePath); // Deletes the old file
      logger.debug('Old audio file deleted.');
    } else {
      logger.error('No old audio file to delete.');
    }
  } catch (err) {
    logger.error('Error deleting old audio file:', err);
  }
}

function getCardInfo(cardBlob) {
  if (!cardBlob) {
    return null; // There was a null value on the front/back of the card.
  }

  logger.debug(`regex input: ${cardBlob}`);
  regex = /^(.*?)(?:\[sound\:(.*?)\])?(?=$)/;
  regexResult = cardBlob.match(regex);
  logger.debug(`regex result: ${regexResult}`);
  textVal = regexResult[1];
  audioFileNameVal = regexResult.length > 2 ? regexResult[2] : null;
  return { text: textVal, audioFileName: audioFileNameVal };
}

function getCard(row, fileType = "csv") {
  cardBlobs = { front: "", back: "" };
  if (fileType == "csv") {
    // Format is- row: [{colname: cellVal}, ...]
    for (let i = 0; i < Object.keys(cardBlobs).length; i++) {
      colName = Object.keys(row)[i];
      colCell = row[colName];
      cardBlobs[Object.keys(cardBlobs)[i]] = colCell;
    }
  } else if (fileType == "txt") {
    logger.debug('flashcard from txt: ' + row);
    row = row.split(backCardDelim);
    logger.debug('split flashcard from .txt: ' + row);
    cardBlobs.front = row[0];
    cardBlobs.back = row[1];
  }
  logger.debug("Card blobs: " + JSON.stringify(cardBlobs));
  card = { front: getCardInfo(cardBlobs.front), back: getCardInfo(cardBlobs.back) };

  if (!card.front || !card.back) {
    return null; // Missing a side nullifies the entire card.
  }

  return card;
}

function loadFlashcards() {
  try {

    let readStream = fs.createReadStream(importFilePath);

    readStream
      .on('open', () => {
        if (importFileType == "csv") {
          processCsvFile(readStream);
        } else if (importFileType == "txt") {
          processTxtFile(readStream);
        }
        document.getElementsByTagName('title')[0].innerHTML = `Flashcard Audio Recorder - ${path.parse(importFilePath).name}`;
      })
      .on('error', (err) => {
        if (err.code === 'ENOENT') {
          logger.error(`Error: The file ${importFilePath} does not exist.`);
        }
        logger.error(`Error: ${err.message}`);
        handleProcessingError()
      });

  } catch {
    handleProcessingError();
  }


}

function copyAllFlashcardAudio() {
  // copy or rewrite the audio to the new localDir, for all flashcards, after the file is imported. 
  let flashcardSide;
  logger.info(`Using prevAudioDir ${prevAudioDir}`);
  flashcards.forEach(flashcard => {
    try {
      flashcardSide = flashcard.front;
      logger.debug('copying front auido');
      rewriteAudioFile(null, copy = true, card = flashcard.front);
      logger.debug('copying back audio');
      flashcardSide = flashcard.back;
      rewriteAudioFile(null, copy = true, card = flashcard.back);
    } catch (err) {
      logger.error(`faild to rewrite ${flashcardSide.text}, error ${err}`)
    }

  });
  logger.info(`Setting prevAudioDir to the current importFilePath ${importFilePath}`);
  prevAudioDir = path.dirname(importFilePath);
}

function processTxtFile(readStream) {
  const rl = readline.createInterface({
    input: readStream,
    crlfDelay: Infinity, // Handles all types of line endings
  });

  rl.on('line', (line) => {
    card = getCard(line, "txt");
    if (card) {
      logger.debug("loaded card: " + JSON.stringify(card));
      flashcards.push(card);
    } else {
      logger.error('Error loading flashcard - skipping line: ' + line);
    }
  });

  rl.on('close', () => {
    logger.debug('Tab-delimited file processing completed. Flashcards: ' + flashcards);
    copyAllFlashcardAudio();
    updateFlashcard();
    // TODO: Refactor and ideally separate duplicate business logic.
    if (userConfig.listenAfterLoad) {
      startListening();
    }


  });

  rl.on('error', handleProcessingError);
}

function processCsvFile(readStream) {
  readStream
    .pipe(csv())
    .on('data', (row) => {
      card = getCard(row, "csv");
      if (card) {
        logger.debug("loaded card: " + JSON.stringify(card));
        flashcards.push(card);
      } else {
        logger.error('Error loading flashcard - skipping row: ' + row);
      }
    })
    .on('end', () => {
      // logger.debug("Flashcards: " + flashcards);
      // TODO: Refactor this gigantic mess. Especially the audio copy
      copyAllFlashcardAudio();
      updateFlashcard();

      if (userConfig.listenAfterLoad) {
        startListening();
      }


    })
    .on('error', handleProcessingError);

}

function handleProcessingError(err) {
  logger.error('Error reading the file:', err);
  document.getElementById("flashcard").innerText = "Error importing flashcards. Please check the formatting and try again.";
  // TODO: Refactor the disabled logic.
  document.getElementById("previousButton").disabled = true;
  document.getElementById("nextButton").disabled = true;
  listenButton.disabled = true;
}

function generateFlashcardAudioDetails(appendTimestamp = false, flashcard = currentCard) {
  // Generates a flashcardName and path using the current importPath and fileName
  // appendTimestamp busts the cache, which ensures that the listen function will play the latest version of the audioFile. 
  let suffix = appendTimestamp ? getFormattedDate() : "";
  let fileName = audioPathSettings.filePrefix + flashcard.text + suffix + audioPathSettings.formatType;
  // New flashcards use the path from the current importPath
  let filePath = path.join(path.dirname(importFilePath), fileName);
  let fileDetails = { path: filePath, name: fileName };
  logger.debug(`Generated flashcardAudioDetails: ${JSON.stringify(fileDetails)}`);
  return fileDetails;
}

function getFlashcardAudioDetails(appendTimestamp = false, card = currentCard) {
  let fileName;
  let filePath;
  let fileDetails = {};
  // TODO: Refactor - Dry violation. Basically a duplicate of generate.
  // Also, tons of reference to object names that can change on a whim.
  logger.debug(`flashcard audio name: ${JSON.stringify(card)}`);
  if (card.audioFileName != null) {
    logger.debug('audioFilename is not null');
    fileName = card.audioFileName;
    // Gets the path from the previous import directory (or the current dir if the imoprt is complete)
    filePath = path.join(prevAudioDir, fileName);
    fileDetails = { path: filePath, name: fileName };
  }
  logger.debug(`Fetched flashcardAudioDetails: ${JSON.stringify(fileDetails)}`);
  return fileDetails;
}

function getOrGenerateFlashcardAudioDetails(appendTimestamp = false, card = currentCard) {
  if (card.audioFileName) {
    return getFlashcardAudioDetails(appendTimestamp, card);
  } else {
    logger.debug('generating new card, as filename is null');
    return generateFlashcardAudioDetails(appendTimestamp, card);
  }
}

function updateDisplay() {
  document.getElementById("currentFlashcardIndex").innerText = currentIndex + 1;
  document.getElementById("maxFlashcardIndex").innerText = flashcards.length;

  prevDisabled = currentIndex <= 0 && sideEnum[side] != "back";
  nextDisabled = currentIndex >= flashcards.length - 1 && sideEnum[side] != "front";
  document.getElementById("previousButton").disabled = prevDisabled;
  document.getElementById("nextButton").disabled = nextDisabled;
  // Refactor
  document.getElementById("recordButton").disabled = !currentCard || !flashcards || !flashcards.length || flashcards.length <= 0; // Can't record if there aren't any flashcards. 

}

function updateFlaschardAudioPath(flashcard = currentCard) {
  // Load audio file if it exists, otherwise empty the card.src and disable listenButton
  audioFilePath = getOrGenerateFlashcardAudioDetails(false, flashcard).path;
  logger.debug(`looking for path ${audioFilePath} and hoping it matches ${flashcard.audioFileName}`);
  if (fs.existsSync(audioFilePath)) {
    logger.debug("audio path exists");
    audioElement.src = audioFilePath;
    listenButton.disabled = false;
  } else {
    logger.debug("audio path not found");
    audioElement.src = '';
    listenButton.disabled = true;
  }
}

function updateFlashcard() {
  if (!flashcards || flashcards.length <= 0) {
    document.getElementById('flashcard').innerText = "Please use the File menu to import flashcards.";
  }
  else if (currentIndex < flashcards.length) {
    // Display flashcard counter and the side indicator icon.
    counterDiv.classList.remove('hidden');
    document.getElementById(`${sideEnum[side]}-indicator`).classList.remove('hidden');
    document.getElementById(`${sideEnum[(side + 1) % 2]}-indicator`).classList.add('hidden');

    // Display the currentCard's text in the view
    currentCard = flashcards[currentIndex][sideEnum[side]];
    logger.debug("Updating Current card: " + JSON.stringify(currentCard));
    document.getElementById('flashcard').innerText = currentCard.text;

    // Load the currentCard's audioFile, if it exists (and set audioElement src and enable listenButton). 
    updateFlaschardAudioPath(currentCard);
    celebrateIfComplete();

  } else {
    document.getElementById('flashcard').innerText = "End of Flashcards";
  }
  updateDisplay();
}

function toggleRecording() {
  if (!recorder) {
    logger.debug('toggle recording start.');
    startRecording();
  } else {
    logger.debug('toggle recording stop.');
    stopRecording();
  }
}

function toggleListening() {
  if (!listening) {
    startListening();
  } else {
    stopListening();
  }
}

function startListening() {
  logger.debug(`Start Listening Called`);

  if (audioElement.src) {
    audioElement.play()
      .then(() => {
        logger.debug(`Listening to ${audioElement.src}`);
        listenButton.innerText = 'Stop Listening';
        listening = true;
        audioElement.currentTime = 0;
      })
      .catch((error) => {
        logger.error(`Error playings audio ${error}`);
        listenButton.disabled = true;
      });

  }
}

function stopListening() {
  logger.debug(`Stop Listening Called`);
  listenButton.innerText = defaultListenText;
  if (audioElement) {
    logger.debug(`Stop Listening`);
    listening = false;
    audioElement.pause();       // Pauses the audio
    audioElement.currentTime = 0; // Resets the audio to the beginning
  }
}

function startRecording() {
  stopListening();

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      recorder = new RecordRTC(stream, { type: 'audio' });
      recorder.startRecording();
      // While recording, stop listening and disable the listen button.
      document.getElementById("listenButton").disabled = true;
      document.getElementById('recordButton').innerText = 'Stop Recording';
    });
}

// TODO: Split up and refactor
function rewriteAudioFile(buffer = null, copy = false, card = currentCard) {

  // Get the old/new filename based on the currentCard values
  prevFileDetails = getFlashcardAudioDetails(appendTimestamp = true, card)
  prevFilePath = prevFileDetails.path;
  newFileDetails = generateFlashcardAudioDetails(appendTimestamp = true, card);
  newFilePath = newFileDetails.path;
  let action = 'rewriteAudioFile called';
  logger.debug(`${action} Prev: ${prevFilePath} New: ${newFilePath}`);

  try {
    // If there is an audioBuffer, aka a new recording, use this to write the new file.
    // Otherwise, it's a transferRequest, and we copy/rename the existing file.
    if (buffer) {
      action = 'writing audioPath';
      fs.writeFileSync(newFilePath, Buffer.from(buffer));
      logger.debug(`finished ${action}`);

      action = 'deleting oldAudioFile';
      recorder = null; // Reset the recorder for the next recording
      deleteAudioFile(prevFilePath);
      logger.debug(`finished ${action}`);
    } else {
      if (newFilePath == prevFilePath || fs.existsSync(newFilePath) || !prevFilePath) {
        logger.info(`Not copying/renaming the audio file with prevPath ${prevFilePath} and newPath ${newFilePath}. Paths are either identical, the proposed copy already exists, or the prev path is missing.`);
        return;
      }
      // TODO: Simplify
      if (copy && path.dirname(newFilePath) == path.dirname(prevFilePath) && removeFormattedDate(path.basename(newFilePath)) == removeFormattedDate(path.basename(prevFilePath))) {
        logger.info(`Skipping audioFileCopy, as the copy location is in the same parent directory. Existing copy: ${prevFilePath} was not copied to ${newFilePath}`);
        return;
      }

      if (copy) {
        // Only copies from different directories. Same dir's should be a rename (avoids redundant audio file copies on import). 
        action = 'copying audioFile';
        fs.copyFileSync(prevFilePath, newFilePath);
      } else {
        action = 'renaming audioFile'
        fs.renameSync(prevFilePath, newFilePath);
      }
      logger.debug(`finished ${action}`);
    }
  } catch (err) {
    logger.error(`ERROR Rewriting audioFile - action: ${action} error: ${err}`);
    return;
  }

  // Update the card's audioInfo, then write to the output file. 
  card.audioFileName = newFileDetails.name;
  updateFlashcard();
  logger.debug(`exporting card ${card} with name ${card.audioFileName}`);
  exportFile(importFileType);

}

async function stopRecording(autoStopped = false) {
  logger.debug('StopRecording triggered');
  logger.debug(`stopRecording - begin ${new Date().getTime()}`);
  document.getElementById('recordButton').innerText = defaultRecordText;
  document.getElementById("listenButton").disabled = false;

  if (recorder) {
    // TODO: Refactor or remove. Also fix bug: It currently requires timeout (left/right arrow bug/delay if the user is fast). Removing the timeout cuts the audio recording short (e.g. the recording will be missing the last second or 2). 
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        recorder.stopRecording(async () => {
          logger.debug('Inner stopRecording triggered');
          let audioBlob = recorder.getBlob();
          const buffer = await audioBlob.arrayBuffer();
          rewriteAudioFile(buffer);

          if (userConfig.listenAfterRecord && !autoStopped) {
            startListening();
          }
          logger.debug(`returning after stop`);

          logger.debug(`stopRecording - end ${new Date().getTime()}`);
          resolve();
        });
      }, 200);
    });
  }
  return;


}

async function nextCard() {
  // TODO: Refactor via template pattern, DRY. Also, the front/back hardcoding is messy.
  // Flip a bit and increment/decrement if it leads to a front facing card (e.g 0)?
  if (currentIndex < flashcards.length - 1 || side == 0) {
    stopListening();
    await stopRecording(autoStopped = true);

    // ^ is XOR, here it is used to flip the side bit. Side 0 turns to 1 and vice versa.
    side = side ^ 1;
    if (sideEnum[side] == "front") {
      currentIndex++;
    }
    logger.debug(`prevCard - updating ${new Date().getTime()}`);
    updateFlashcard();
    if (userConfig.listenAfterLoad) {
      startListening();
    }
    exportFile('config');

  }
}

async function previousCard() {
  if (currentIndex > 0 || side == 1) {
    stopListening();
    await stopRecording(autoStopped = true);

    side = side ^ 1;
    if (sideEnum[side] == "back") {
      currentIndex--;
    }
    logger.debug(`prevCard - updating ${new Date().getTime()}`);
    updateFlashcard();
    if (userConfig.listenAfterLoad) {
      startListening();
    }
    exportFile('config');

  }
}

function isEditMode() {
  return flashInput.style.display !== 'none';
}

function toggleEdit() {
  // Toggle visibility for text and input.
  flashInput.style.display = flashInput.style.display == "none" ? "" : "none";
  flashText.style.display = flashText.style.display == "none" ? "" : "none";

  // set the inputText equal to the flashcard text when editMode is toggled on.
  if (isEditMode()) {
    flashInput.value = flashText.innerText;
    flashInput.focus(); // Places the cursor inside the input field
  }
}

function celebrateIfComplete() {
  if (isComplete() && !celebrated) {
    logger.debug(`Celebration time!`);
    celebrated = true;
    modal.classList.remove('hidden');
    document.getElementById('modal-img').src="assets/danke.gif";
    document.getElementById('modal-text').innerHTML="Daghang Salamat LJ!";
  }
}

function isComplete() {
  let isComplete = true;
  if (!flashcards || !flashcards.length) { return false; }

  // Cards are complete if no incomplete card exists. An incomplete card is a card that's missing a text value or audioFile.
  for ([curCardIndex, curCard] of flashcards.entries()) {
    // Skip card if it's equal or less than the lastChecked cardIndex (lastChecked defaults to -1 for the case of 0)
    if (curCardIndex <= lastCheckedIndex) {
      continue; // Assuming previously checked cards are still good (audio should never be deleted mid-app. This should help performance).
    }

    logger.info(`Celebration ${JSON.stringify(curCard)}`);
    frontCard = curCard.front;
    backCard = curCard.back;
    frontFileDetails = getFlashcardAudioDetails(appendTimestamp = true, frontCard);
    backFileDetails = getFlashcardAudioDetails(appendTimestamp = true, backCard);
    
    cardHasText = frontCard.text && backCard.text
      && frontFileDetails && frontFileDetails.path
      && backFileDetails && backFileDetails.path;
    isComplete = cardHasText
      && fs.existsSync(frontFileDetails.path) && fs.existsSync(backFileDetails.path);
    logger.debug(`Celebration ${JSON.stringify(frontCard)}, ${JSON.stringify(backCard)} frontDetails ${JSON.stringify(frontFileDetails)} backDetails ${JSON.stringify(backFileDetails)}`);
    if (!isComplete) {
      logger.debug(`Celebration not complete. Ending at card ${curCardIndex}: ${JSON.stringify(curCard)}. cardHasText ${cardHasText}`);
      return false;
    } else {
      lastCheckedIndex = curCardIndex;
    }
  }
  return true;
}

function editCard() {
  if (isEditMode()) {
    currentCard.text = flashInput.value; // Edit mode is active and about to be toggled off. Save the input value to the card.
    flashText.innerText = currentCard.text;
  }
  rewriteAudioFile(); // Renames the audio file, writes the new card info to exportFile
  toggleEdit();
}

// TODO: Template pattern. DRY violation with the above edit

function isEditCounterMode() {
  return counterInput.style.display !== 'none';
}

function toggleEditCounter() {
  // Toggle visibility for text and input.
  counterInput.style.display = counterInput.style.display == "none" ? "" : "none";
  counterText.style.display = counterText.style.display == "none" ? "" : "none";

  // Edit mode was off and is about to be toggled on. Set the inputValue to the currentIndex.
  if (isEditCounterMode()) {
    counterInput.value = counterText.innerText;
    counterInput.focus(); // Places the cursor inside the input field
  }
}

async function editCounter() {
  // Edit mode is on and is about to be toggled off. Set the currentIndex to the inputValue (after validation).
  if (isEditCounterMode()) {
    let newIndexInput = counterInput.value;
    let newFlashcardIndex = 0;
    let validCounterValue = false;
    if (newIndexInput != null) {
      logger.info(`Attempting to jump to flashcard number ${newIndexInput}`);
      // Valid newFlashcardIndex must be a non-null, positive integer that matches an existing flashcard number (0,lengthOfFlashcards].
      newFlashcardIndex = parseInt(newIndexInput);
      logger.info(`New flashcard number ${newFlashcardIndex}`);
      validCounterValue = !isNaN(newFlashcardIndex) && newFlashcardIndex > 0 && newFlashcardIndex <= flashcards.length;
    }
    if (validCounterValue) {
      currentIndex = newFlashcardIndex - 1; // Flashcard array starts at 0, but appears to start at 1 to the user.
      // counterText.value = currentIndex;
      side = 0;

      stopListening();
      await stopRecording(autoStopped = true);

      updateFlashcard();
      exportFile('config');
      if (userConfig.listenAfterLoad) {
        startListening();
      }
    } else {
      logger.error(`invalid flashcard number ${newIndexInput}. Exiting edit mode and remaining on the current card.`);
    }
  }

  toggleEditCounter();
}

async function init(load = true) {
  // generate pathNames and userConfig
  baseDir = await electronGetDataPath();
  configFilePath = await electronGetConfigPath();
  configFilePath = path.join(configFilePath, 'config.json');
  processUserConfig();
  importFilePath = userConfig.recentImportPath;
  prevAudioDir = path.dirname(importFilePath); // TODO: Fix bug. This is overwriting the import auido path
  importFileType = importFilePath?.split('.').at(-1);
  logger.debug(`Initializing, loading=${load} importPath ${importFilePath} prevAudioDir ${prevAudioDir}`);

  // Reset html/js back to the initial state
  stopListening();
  stopRecording(autoStopped = true);
  flashcards = [];
  currentCard = {};
  currentIndex = 0;
  lastCheckedIndex = -1;
  side = 0;
  document.getElementById(`${sideEnum[(side) % 2]}-indicator`).classList.add('hidden');
  document.getElementById(`${sideEnum[(side + 1) % 2]}-indicator`).classList.add('hidden');
  counterDiv.classList.add('hidden');
  document.getElementById("recordButton").disabled = true; // Can't record if there aren't any flashcards. 

  if (load) {
    currentIndex = userConfig.recentIndex;
    side = userConfig.recentSide;
    logger.error(`Loading index from userConfig. Index: ${currentIndex}, side:${side}`);
    loadFlashcards();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  counterDiv = document.getElementsByClassName('flashcard-counter-container')[0];
  listenButton = document.getElementById('listenButton');
  flashInput = document.getElementById(flashcardInputID);
  flashText = document.getElementById(flashcardTextId);
  counterInput = document.getElementById(counterInputID);
  counterText = document.getElementById(counterTextId);
  modal = document.getElementById('modal');
  closeModalButton = document.getElementById('closeModal');

  document.getElementById('recordButton').addEventListener('click', toggleRecording);
  document.getElementById('previousButton').addEventListener('click', previousCard);
  document.getElementById('nextButton').addEventListener('click', nextCard);
  listenButton.addEventListener('click', toggleListening);
  closeModalButton.addEventListener('click', () => { modal.classList.add('hidden'); });

  window.onclick = function(event) {
      if (event.target === modal) {
          modal.classList.add('hidden')
      }
  }

  flashInput.addEventListener('blur', () => {
    // Skip if element is no longer visible
    if (flashInput.offsetParent === null) {
      return; // element is hidden (e.g. display: none)
    }

    editCard(); // only runs if the input is still visible
  });
  // TODO: Major DRY violation.
  counterInput.addEventListener('blur', () => {
    if (counterInput.offsetParent === null) {
      return; // element is hidden (e.g. display: none)
    }

    editCounter();
  });

  audioElement.addEventListener('ended', () => {
    stopListening();
  });

  // Add event listener for keyboard shortcuts
  document.addEventListener('keydown', (event) => {
    if (isEditMode()) {
      if (event.code === 'Enter' || event.code === 'Escape') {
        event.preventDefault();
        editCard();
      }
    } else if (isEditCounterMode()) {
      if (event.code === 'Enter' || event.code === 'Escape') {
        event.preventDefault();
        editCounter();
      }
    }
    else if (event.code === 'Space') {
      event.preventDefault();
      toggleRecording();
    } else if (event.code === 'ArrowRight') {
      event.preventDefault();
      nextCard();
    } else if (event.code === 'Enter') {
      event.preventDefault();
      toggleListening();
    } else if (event.code === 'ArrowLeft') {
      event.preventDefault();
      previousCard();
    } else if (event.code === 'Escape') {
      event.preventDefault();
      editCounter();
    }
  });

  ipcRenderer.on('import-file', () => {
    logger.debug('Electron import file event triggered');
    electronImport();  // Trigger the actual import function when called from the Electron Menu
  });

  ipcRenderer.on('export-file', () => {
    logger.debug('Electron export file event triggered');
    electronExportFile();  // Trigger the actual export function when called from the Electron Menu
  });

  ipcRenderer.on('copy-text', () => {
    logger.debug('Electron copy text event triggered');
    electronCopyTextToClipboard();
  });

  ipcRenderer.on('edit-text', () => {
    logger.debug('Electron edit text event triggered');
    electronEditText();
  })

  ipcRenderer.on('update-preferences', (event, data) => {
    logger.debug('Electron update pref event triggered');
    electronUpdatePreferences(data);
  })

  // Load flashcards when the application starts
  init();

});

