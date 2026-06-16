This folder must contain transformers.min.js before the Whisper transcription
feature will work.

To download it, open a terminal in the meet-notetaker-extension folder and run:

    bash setup.sh

Or manually download this URL and save it as lib/transformers.min.js:

    https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/dist/transformers.min.js

After adding the file, go to chrome://extensions and click "Reload" on the extension.
