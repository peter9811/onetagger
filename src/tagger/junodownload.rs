use reqwest::blocking::Client;
use scraper::{Html, Selector, ElementRef};
use chrono::NaiveDate;
use regex::Regex;
use std::error::Error;

use crate::tagger::{Track, MusicPlatform, TrackMatcher, AudioFileInfo, TaggerConfig, MatchingUtils};

pub struct JunoDownload {
    client: Client
}

impl JunoDownload {
    //New instance
    pub fn new() -> JunoDownload {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:85.0) Gecko/20100101 Firefox/85.0")
            .build()
            .unwrap();

        JunoDownload {
            client
        }
    }

    //Search releases, generate tracks
    pub fn search(&self, query: &str) -> Result<Vec<Track>, Box<dyn Error>> {
        let mut response = self.client
            .get("https://www.junodownload.com/search/")
            .query(&[("q[all][]", query), ("solrorder", "relevancy"), ("items_per_page", "50")])
            .send()?
            .text()?;

        //Minify and parse
        minify_html::in_place_str(&mut response, &minify_html::Cfg {minify_js: false, minify_css: false}).unwrap();
        let document = Html::parse_document(&response);

        let mut out = vec![];
        let release_selector = Selector::parse("div.jd-listing-item").unwrap();
        for (index, release_element) in document.select(&release_selector).enumerate() {
            //Release
            if let Some(tracks) = self.parse_release(&release_element) {
                out.extend(tracks);
            } else {
                //Garbage elements at end of page
                if index < 50 {
                    warn!("Error parsing JunoDownload release! Index: {}, Query: {}", index, query);
                }
            }
        }

        Ok(out)
    }

    //Parse data from release element
    fn parse_release(&self, elem: &ElementRef) -> Option<Vec<Track>> {
        let mut out = vec![];
        //Artists
        let mut selector = Selector::parse("div.juno-artist").unwrap();
        let artist_element = elem.select(&selector).next()?;
        let artists = artist_element.text().filter(|a| a != &"/").collect::<Vec<_>>();
        //Release title
        selector = Selector::parse("a.juno-title").unwrap();
        let title_elem = elem.select(&selector).next()?;
        let title = title_elem.text().collect::<Vec<_>>().join(" ");
        let url = title_elem.value().attr("href")?;
        //Label
        selector = Selector::parse("a.juno-label").unwrap();
        let label = elem.select(&selector).next()?.text().collect::<Vec<_>>().join(" ");
        //Info text
        selector = Selector::parse("div.col.text-right div.text-sm").unwrap();
        let mut info_text = elem.select(&selector).next()?.text().collect::<Vec<_>>();
        //Date, genres, remove bardcode
        if info_text.len() == 3 {
            info_text = info_text[1..].to_vec();
        }
        let release_date = NaiveDate::parse_from_str(info_text[0], "%d %b %y").ok()?;
        let genres: Vec<String> = info_text[1].split("/").map(|g| g.to_string()).collect();
        //Album art
        selector = Selector::parse("div.col img").unwrap();
        let image_elem = elem.select(&selector).next()?;
        let album_art_small = image_elem.value().attr("src")?;
        //Full resolution img
        let album_art = format!("https://imagescdn.junodownload.com/full/{}-BIG.jpg", 
            album_art_small.split("/").last().unwrap().replace(".jpg", ""));

        //Tracks
        let track_selector = Selector::parse("div.jd-listing-tracklist div.col").unwrap();
        for track_elem in elem.select(&track_selector) {
            let text = track_elem.text().collect::<Vec<_>>();
            let full = text[0].replace("\u{a0}", " ");
            //Delete duration
            let re = Regex::new(r" - \(\d+:\d\d\) ?$").unwrap();
            let no_duration = re.replace(&full, "");
            //Check if title or artist - title
            let split: Vec<&str> = no_duration.split(" - \"").collect();
            let mut track_artists = vec![];
            //Only title
            let track_title = if split.len() == 1 {
                split[0].to_string()
            } else {
                //Artists - "Title"
                track_artists = split[0].split(" & ").collect();
                split[1].replace("\"", "")
            };
            //BPM
            let bpm: Option<i64> = if text.len() == 2 {
                Some(text[1].replace("\u{a0}BPM", "").parse::<i64>().ok()?)
            } else {
                None
            };
            //Get artists for track
            if track_artists.len() == 0 {
                track_artists = artists.clone();
            }
            //Generate track
            out.push(Track {
                platform: MusicPlatform::JunoDownload,
                title: track_title,
                version: None,
                artists: track_artists.into_iter().map(|a| a.to_string()).collect(),
                album: Some(title.to_owned()),
                bpm,
                genres: genres.to_owned(),
                key: None,
                label: Some(label.to_string()),
                styles: vec![],
                publish_date: None,
                publish_year: None,
                release_year: None,
                release_date: Some(release_date),
                art: Some(album_art.to_string()),
                url: Some(format!("https://www.junodownload.com{}", url))
            });
        }

        Some(out)
    }
}

impl TrackMatcher for JunoDownload {
    fn match_track(&self, info: &AudioFileInfo, config: &TaggerConfig) -> Result<Option<(f64, Track)>, Box<dyn Error>> {
        //Search
        let query = format!("{} {}", info.artists.first().unwrap(), MatchingUtils::clean_title(&info.title));
        let tracks = self.search(&query)?;
        //Match
        if let Some((acc, track)) = MatchingUtils::match_track(&info, &tracks, &config) {
            return Ok(Some((acc, track)));
        }
        Ok(None)
    }
}