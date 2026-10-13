//! Research papers for the second pen's facts (SPECs/second-pen-spec.md#facts).
//! One search over OpenAlex (no key needed), ranked the way the writer asked:
//! the most cited of the recent papers, then the newest of the rest. The pen
//! writes its fact from the chosen paper's abstract and cites it.

use crate::commands::link_preview::client;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

const OPENALEX: &str = "https://api.openalex.org/works";
/** "Recent" is this many years back from the start of this year. */
const RECENT_YEARS: i32 = 3;
const PER_QUERY: usize = 10;
/** How many ranked papers the pen gets to choose from. */
const RETURNED: usize = 5;
const ABSTRACT_CHARS: usize = 1_200;
const FIELDS: &str = "id,doi,title,publication_year,publication_date,cited_by_count,authorships,primary_location,abstract_inverted_index";

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Paper {
    pub title: String,
    /// Up to three, in order.
    pub authors: Vec<String>,
    pub year: Option<i32>,
    /// `YYYY-MM-DD`, for "newest".
    pub date: Option<String>,
    pub venue: Option<String>,
    pub cited_by: u64,
    /// The DOI link when there is one, else the publisher's page, else OpenAlex.
    pub url: String,
    pub abstract_text: Option<String>,
}

#[derive(Deserialize)]
struct Page {
    results: Vec<Work>,
}

#[derive(Deserialize)]
struct Work {
    id: String,
    doi: Option<String>,
    title: Option<String>,
    publication_year: Option<i32>,
    publication_date: Option<String>,
    #[serde(default)]
    cited_by_count: u64,
    #[serde(default)]
    authorships: Vec<Authorship>,
    primary_location: Option<Location>,
    abstract_inverted_index: Option<BTreeMap<String, Vec<usize>>>,
}

#[derive(Deserialize)]
struct Authorship {
    author: Option<Author>,
}

#[derive(Deserialize)]
struct Author {
    display_name: Option<String>,
}

#[derive(Deserialize)]
struct Location {
    landing_page_url: Option<String>,
    source: Option<Source>,
}

#[derive(Deserialize)]
struct Source {
    display_name: Option<String>,
}

/// OpenAlex stores abstracts as word → positions; put the words back in order.
fn abstract_from_index(index: &BTreeMap<String, Vec<usize>>) -> String {
    let mut words: Vec<(usize, &str)> = index
        .iter()
        .flat_map(|(word, positions)| positions.iter().map(move |&p| (p, word.as_str())))
        .collect();
    words.sort_unstable_by_key(|&(p, _)| p);
    let text = words.iter().map(|&(_, w)| w).collect::<Vec<_>>().join(" ");
    if text.chars().count() <= ABSTRACT_CHARS {
        return text;
    }
    let cut: String = text.chars().take(ABSTRACT_CHARS).collect();
    format!("{}…", cut.trim_end())
}

fn paper_of(work: Work) -> Option<Paper> {
    let title = work.title?.trim().to_owned();
    if title.is_empty() {
        return None;
    }
    let location = work.primary_location;
    let url = work
        .doi
        .or_else(|| location.as_ref().and_then(|l| l.landing_page_url.clone()))
        .unwrap_or(work.id);
    Some(Paper {
        title,
        authors: work
            .authorships
            .into_iter()
            .filter_map(|a| a.author.and_then(|a| a.display_name))
            .take(3)
            .collect(),
        year: work.publication_year,
        date: work.publication_date,
        venue: location.and_then(|l| l.source).and_then(|s| s.display_name),
        cited_by: work.cited_by_count,
        url,
        abstract_text: work
            .abstract_inverted_index
            .as_ref()
            .map(abstract_from_index),
    })
}

/// The writer's order: recent papers by citations (newest first on a tie),
/// then older ones newest first. A paper in both lists counts once.
fn rank(recent: Vec<Paper>, any: Vec<Paper>) -> Vec<Paper> {
    let mut recent = recent;
    recent.sort_by(|a, b| {
        b.cited_by
            .cmp(&a.cited_by)
            .then_with(|| b.date.cmp(&a.date))
    });
    let mut seen: HashSet<String> = recent.iter().map(|p| p.url.clone()).collect();
    let mut rest: Vec<Paper> = any
        .into_iter()
        .filter(|p| seen.insert(p.url.clone()))
        .collect();
    rest.sort_by(|a, b| b.date.cmp(&a.date));
    recent.into_iter().chain(rest).take(RETURNED).collect()
}

fn this_year() -> i32 {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Close enough for a year boundary filter.
    1970 + (secs / 31_556_952) as i32
}

async fn search(query: &str, from_year: Option<i32>) -> Result<Vec<Paper>, AppError> {
    // Journal articles and reviews: preprints and datasets are not what a fact should cite.
    let mut filter = "has_abstract:true,type:article|review".to_owned();
    if let Some(year) = from_year {
        filter.push_str(&format!(",from_publication_date:{year}-01-01"));
    }
    let per_page = PER_QUERY.to_string();
    let url = reqwest::Url::parse_with_params(
        OPENALEX,
        &[
            ("search", query),
            ("filter", filter.as_str()),
            ("per-page", per_page.as_str()),
            ("select", FIELDS),
        ],
    )
    .map_err(|e| AppError::Network(e.to_string()))?;
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "The paper search answered {}",
            response.status()
        )));
    }
    let page: Page = response
        .json()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    Ok(page.results.into_iter().filter_map(paper_of).collect())
}

/// Papers on `query`, best first: the most cited of the last few years,
/// then the newest of the rest. Empty when nothing matches.
#[tauri::command]
pub async fn search_papers(query: String) -> Result<Vec<Paper>, AppError> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let from = this_year() - RECENT_YEARS;
    let (recent, any) = tokio::join!(search(query, Some(from)), search(query, None));
    // One of the two failing still leaves papers to choose from.
    match (recent, any) {
        (Err(error), Err(_)) => Err(error),
        (recent, any) => Ok(rank(recent.unwrap_or_default(), any.unwrap_or_default())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paper(url: &str, date: &str, cited_by: u64) -> Paper {
        Paper {
            title: url.to_owned(),
            authors: vec![],
            year: date.get(..4).and_then(|y| y.parse().ok()),
            date: Some(date.to_owned()),
            venue: None,
            cited_by,
            url: url.to_owned(),
            abstract_text: None,
        }
    }

    #[test]
    fn recent_by_citations_then_rest_newest_first() {
        let recent = vec![
            paper("a", "2024-05-01", 3),
            paper("b", "2023-02-01", 40),
            paper("c", "2025-01-01", 40),
        ];
        let any = vec![
            paper("old", "2001-01-01", 900),
            paper("b", "2023-02-01", 40),
            paper("older", "1999-01-01", 5000),
            paper("mid", "2015-01-01", 10),
        ];
        let urls: Vec<String> = rank(recent, any).into_iter().map(|p| p.url).collect();
        assert_eq!(urls, ["c", "b", "a", "mid", "old"]);
    }

    #[test]
    fn no_recent_papers_means_newest_first() {
        let any = vec![paper("x", "2010-01-01", 1), paper("y", "2019-01-01", 1)];
        let urls: Vec<String> = rank(vec![], any).into_iter().map(|p| p.url).collect();
        assert_eq!(urls, ["y", "x"]);
    }

    #[test]
    fn abstract_words_back_in_order() {
        let mut index = BTreeMap::new();
        index.insert("sleep".to_owned(), vec![1]);
        index.insert("We".to_owned(), vec![0]);
        index.insert("studied".to_owned(), vec![2]);
        index.insert("sleep.".to_owned(), vec![3]);
        assert_eq!(abstract_from_index(&index), "We sleep studied sleep.");
    }

    #[test]
    fn work_without_doi_links_its_page() {
        let work: Work = serde_json::from_value(serde_json::json!({
            "id": "https://openalex.org/W1",
            "doi": null,
            "title": "A paper",
            "publication_year": 2024,
            "publication_date": "2024-03-01",
            "cited_by_count": 7,
            "authorships": [{ "author": { "display_name": "Ada Lovelace" } }],
            "primary_location": { "landing_page_url": "https://journal.example/a", "source": { "display_name": "Journal" } },
            "abstract_inverted_index": null
        }))
        .unwrap();
        let paper = paper_of(work).unwrap();
        assert_eq!(paper.url, "https://journal.example/a");
        assert_eq!(paper.venue.as_deref(), Some("Journal"));
        assert_eq!(paper.authors, ["Ada Lovelace"]);
    }
}
