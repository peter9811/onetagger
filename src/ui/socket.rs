use std::error::Error;
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::path::Path;
use tungstenite::server::accept;
use tungstenite::{Message, WebSocket};
use serde_json::{Value, json};

use crate::tag::TagChanges;
use crate::tagger::{TaggerConfig, Tagger};
use crate::ui::Settings;
use crate::ui::player::{AudioSources, AudioPlayer};
use crate::ui::OTError;
use crate::ui::quicktag::{QuickTag, QuickTagFile};

//Start WebSocket UI server
pub fn start_socket_server() {
    let server = TcpListener::bind("127.0.0.1:36912").unwrap();
    for stream in server.incoming() {
        thread::spawn(move || {
            //Create player
            let mut player = AudioPlayer::new();

            //Websocket loop
            let mut websocket = accept(stream.unwrap()).unwrap();
            loop {
                match websocket.read_message() {
                    Ok(msg) => {
                        if msg.is_text() {
                            match handle_message(msg.to_text().unwrap(), &mut websocket, &mut player) {
                                Ok(_) => {},
                                Err(err) => {
                                    //Send error to UI
                                    error!("Websocket: {:?}", err);
                                    websocket.write_message(Message::from(json!({
                                        "action": "error",
                                        "message": &format!("{}", err)
                                    }).to_string())).ok();
                                }
                            }
                        }
                    },
                    Err(e) => {
                        //Connection closed
                        if !websocket.can_read() || !websocket.can_write() {
                            warn!("{} - Websocket can't read or write, closing connection!", e);
                            break;
                        }
                        warn!("Invalid websocket message: {}", e);
                    }
                }
            }
        });
    }
}


fn handle_message(text: &str, websocket: &mut WebSocket<TcpStream>, player: &mut AudioPlayer) -> Result<(), Box<dyn Error>> {
    //Parse JSON
    let json: Value = serde_json::from_str(text)?;
    match json["action"].as_str().ok_or("Missing action!")? {
        //Save, load settings from UI
        "saveSettings" => {
            let settings = Settings::from_ui(&json["settings"]);
            settings.save()?;
        },
        "loadSettings" => {
            let settings = Settings::load()?;
            websocket.write_message(Message::from(json!({
                "action": "loadSettings",
                "settings": settings.ui
            }).to_string())).ok();
        },
        //Browse folder
        "browse" => {
            if let Some(path) = tinyfiledialogs::select_folder_dialog("Select path", ".") {
                websocket.write_message(Message::from(json!({
                    "action": "browse",
                    "path": path,
                    "context": json["context"]
                }).to_string())).ok();
            }
        },
        //Start tagger
        "startTagging" => {
            //Parse config
            let config: TaggerConfig = serde_json::from_value(json["config"].clone())?;
            //Validate path
            if !(Path::new(&config.path).exists()) {
                return Err(OTError::new("Invalid path!").into());
            }
            //Start
            let rx = Tagger::tag_dir(&config);
            for status in rx {
                //Update path for display
                let mut s = status.to_owned();
                s.status.path = s.status.path.to_owned().chars().skip(config.path.len()).collect();
                //Send
                websocket.write_message(Message::from(json!({
                    "action": "taggingProgress",
                    "status": status
                }).to_string())).ok();
            }
            //Done
            websocket.write_message(Message::from(json!({
                "action": "taggingDone"
            }).to_string())).ok();
        },
        //Generate waveform, should be run from separate connection
        "waveform" => {
            let path = json["path"].as_str().unwrap();
            let source = AudioSources::from_path(path).unwrap();
            let (waveform_rx, cancel_tx) = source.generate_waveform(250).unwrap();
            //Streamed
            for wave in waveform_rx {
                websocket.write_message(Message::from(json!({
                    "action": "waveformWave",
                    "wave": wave
                }).to_string())).ok();
                //Check reply
                websocket.read_message().ok();
                if !websocket.can_write() {
                    cancel_tx.send(true).ok();
                }
            }
            //Done
            websocket.write_message(Message::from(json!({
                "action": "waveformDone",
            }).to_string())).ok();

        },
        //Load player file
        "playerLoad" => {
            let path = json["path"].as_str().ok_or("Missing path!")?;
            let source = AudioSources::from_path(path)?;
            //Send to UI
            websocket.write_message(Message::from(json!({
                "action": "playerLoad",
                "duration": source.duration() as u64
            }).to_string())).ok();
            //Load
            player.load_file(source);
        },
        //Player controls
        "playerPlay" => {
            player.play();
        },
        "playerPause" => {
            player.pause();
        },
        "playerSeek" => {
            let playing = player.seek(json["pos"].as_i64().ok_or("Missing position!")? as u64);
            //Sync
            websocket.write_message(Message::from(json!({
                "action": "playerSync",
                "playing": playing
            }).to_string())).ok();
        },
        "playerVolume" => {
            let volume = json["volume"].as_f64().ok_or("Missing volume!")? as f32;
            player.volume(volume);
        }
        //Quicktag
        "quicktagLoad" => {
            let path = json["path"].as_str().ok_or("Missing path")?;
            websocket.write_message(Message::from(json!({
                "action": "quicktagLoad",
                "data": QuickTag::load_files(path)?
            }).to_string())).ok();
        },
        //Save quicktag
        "quicktagSave" => {
            let changes: TagChanges = serde_json::from_value(json["changes"].clone())?;
            let tag = changes.commit()?;
            websocket.write_message(Message::from(json!({
                "action": "quicktagSaved",
                "path": &changes.path,
                "file": QuickTagFile::from_tag(&changes.path, &tag).ok_or("Failed loading tags")?
            }).to_string())).ok();
        },
        _ => {}
    };
    Ok(())
}