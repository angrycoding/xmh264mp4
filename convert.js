var FS = require('fs-extra'),
	OS = require('os'),
	Path = require('path'),
	Exec = require('child_process').exec,
	commandLine = require('minimist')(process.argv.slice(2));

var marker1 = Buffer.from([0, 0, 0, 1]);
var marker2 = Buffer.from([0, 0, 1]);

function getTmpFileName(ext) {
	return Path.resolve(OS.tmpdir(), ['splitter', Math.random(), new Date().getTime()].join('-') + '.' + ext);
}

function findMarker(buffer, offset) {

	if (offset === -1) return -1;

	var index = Math.min(
		buffer.indexOf(marker1, offset || 0),
		buffer.indexOf(marker2, offset || 0)
	);

	if (index === -1 && offset < buffer.length) {
		return buffer.length;
	}

	else if (index === -1 && offset >= buffer.length) {
		return -1;
	}

	else return index;

}

function getString(expression, fallback) {
	var result;
	try { result = typeof expression === 'function' ? expression() : expression; } catch (exception) {}
	if (typeof result === 'string') return result;
	if (arguments.length > 1) return fallback;
}

function fileExists(path) {
	return (
		FS.existsSync(path) &&
		FS.lstatSync(path).isFile()
	);
}

function dirExists(path) {
	return (
		FS.existsSync(path) &&
		!FS.lstatSync(path).isFile()
	);
}

function doExec(command, ret, cwd) {
	var options = {};
	if (typeof cwd === 'string') options.cwd = cwd;
	Exec(command.replace(/[\n\t\r]+/g, ' '), options, ret);
}

function infoMessage(message) {
	console.info('[ SPLITTER ]', message);
}

function fatalError(message) {
	console.info('[ SPLITTER ] FATAL ERROR', message.trim());
	process.exit();
}

var inputFile = getString(() => commandLine.input || commandLine.i, '').trim();
var outputFile = getString(() => commandLine.output || commandLine.o, '').trim();

if (!inputFile) {
	fatalError(`missing input file (--input)`);
}

if (!outputFile) {
	fatalError(`missing output file (--output)`);
}

if (!fileExists(inputFile = Path.resolve(process.cwd(), inputFile))) {
	fatalError(`file does not exist: ${inputFile}`);
}

if ((outputFile = outputFile && Path.resolve(process.cwd(), outputFile)) && dirExists(outputFile)) {
	fatalError(`${outputFile} is directory`);
}


infoMessage(`input ${inputFile}`);
infoMessage(`output ${outputFile}`);



function splitInputFile(inputFile, ret) {

	var audioFile = getTmpFileName('pcm');
	var videoFile = getTmpFileName('h264');

	infoMessage('splitting input file...');
	FS.readFile(inputFile, function(e, data) {

		var start = findMarker(data);
		if (start === -1) return;

		var audioStream = FS.createWriteStream(audioFile);
		var videoStream = FS.createWriteStream(videoFile);

		infoMessage('writing temporary files...');

		for (;;) {

			var end = findMarker(data, start + 2);
			if (end === -1) break;

			var frame = data.slice(start, end);
			var frameType = frame[frame.indexOf(1) + 1];

			// unknown data
			if ([249, 252, 253].includes(frameType)) {}

			// audio data
			else if (frameType === 250) {
				var dataStart = frame.indexOf(1);
				frame = frame.slice(dataStart + 6);
				audioStream.write(frame);
			}

			else {
				videoStream.write(frame);
			}



			start = end;



		}

		audioStream.end();
		videoStream.end();

		ret(audioFile, videoFile);


	});
}

splitInputFile(inputFile, function(audioFile, videoFile) {
	var mp3FileName = getTmpFileName('ogg');
	infoMessage('converting pcm into mp3...');
	doExec(`ffmpeg -y -hide_banner  -loglevel warning  -f alaw -ar 8000 -ac 1 -i ${audioFile} ${mp3FileName}`, function(error, stderr, stdout) {
		if (error) fatalError(stdout || stderr || String(error));
		infoMessage('generating output file...');
		doExec(`ffmpeg  -y -hide_banner  -loglevel warning  -i ${videoFile} -i ${mp3FileName} -c:a copy -c:v copy ${outputFile}`, function(error, stderr, stdout) {
			if (error) fatalError(stdout || stderr || String(error));
			infoMessage('done processing, bye!');
		});
	});
});
