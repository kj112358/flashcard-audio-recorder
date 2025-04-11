# Install

# Run
npm run dev

# package
## win32 requires wine and mono if packaging from Linux
npm run make -- --platform win32
npm run make -- --platform linux
npm run make -- --platform darwin

# Usage
## Assumptions: 
csv- header row and 2 columns (A, B correspond to front/back card text)
txt- \t delimeter to specify the front/back of the card. Example:   1+1=\t2    
Microphone - auto-detects your microphone

## Relevant directories:
linux- ~/.config/flashcard-audio-recorder/[/config/config.json, /data/locallyImportedDecks]
windows - yourAppDataPath/flashcard-audio-recorder/[/config/config.json, /data/locallyImportedDecks]

# Future improvements (low priority for now)
Merge Decks: 
	automatically add new cards into the existing deck and update the audio files for existing cards.
Add Cards: 
	Simple feature to add new cards to the list
Bulk view: 
	This is meant to quickly import/export for Anki, so I think it would be nice to have a similar bulk view to select and delete cards.
Review: 
	Probably best left to anki, but I personally would like an easy "redo" pile to loop through. Workflow- Go through an entire deck once, place any failed cards in a redo pile, and only iterate over the redo pile after the current deck is finished. 
Mobile-app: 
	If it's going to be used for reviewing and generating cards, maybe add mobile support by wrapping it with react-native or ionic (pre-req: refactoring)
Refactoring:
	the code was quickly hacked together. The code would greatly benefit from cleaning, architecture, removing dry, adhering to solid, switching from node dependencies for local file management to db and servers, etc..
