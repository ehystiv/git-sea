//! Lane assignment for the commit graph.
//!
//! Commits arrive in topological order (children before parents), one at a time, and each one
//! gets a lane (a "column" of the graph) plus the edges to draw around it. The layout only keeps
//! the list of active lanes, so it can be fed chunk after chunk and resumed at any point.
//!
//! Every lane remembers the commit it is waiting for. For a commit `C`:
//! 1. `C` takes the first lane waiting for it; if none does (a branch tip), it takes the first free lane.
//! 2. Every other lane waiting for `C` merges into it (`MergeIn`) and is freed.
//! 3. The first parent continues on the same lane, keeping its colour.
//! 4. The other parents join the lane already waiting for them, or open a new one (`ForkOut`).
//! 5. Trailing free lanes are dropped; free lanes in the middle are reused by the next tip or fork.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Number of distinct branch colours the frontend palette provides.
pub const COLOR_COUNT: u8 = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum EdgeKind {
    /// A lane running past this commit without touching it (`from_lane == to_lane`).
    Through,
    /// The commit's own lane arriving from its children (`from_lane == to_lane == lane`).
    In,
    /// The commit's own lane leaving towards its first parent (`from_lane == to_lane == lane`).
    Out,
    /// Another lane (`from_lane`) joining the commit's lane (`to_lane`) from the children side.
    MergeIn,
    /// The commit's lane (`from_lane`) reaching the lane (`to_lane`) of a non-first parent.
    ForkOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub from_lane: u16,
    pub to_lane: u16,
    pub kind: EdgeKind,
    /// Index into the branch palette.
    pub color: u8,
}

/// Placement of one commit. Row `i` belongs to the `i`-th commit of the walk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GraphRow {
    pub lane: u16,
    pub color: u8,
    pub edges: Vec<Edge>,
}

#[derive(Clone, Copy)]
struct Slot<K> {
    expects: K,
    color: u8,
}

#[derive(Clone)]
pub struct LaneLayout<K> {
    lanes: Vec<Option<Slot<K>>>,
    /// Used only when every palette colour is taken by an active lane.
    rotate: u8,
    max_width: usize,
}

impl<K: Copy + Eq> Default for LaneLayout<K> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K: Copy + Eq> LaneLayout<K> {
    pub fn new() -> Self {
        Self {
            lanes: Vec::new(),
            rotate: 0,
            max_width: 0,
        }
    }

    /// Most lanes that were open at the same time so far.
    pub fn max_width(&self) -> usize {
        self.max_width
    }

    /// Places the next commit of the walk. `parents` are in commit order (first parent first).
    pub fn push(&mut self, id: K, parents: &[K]) -> GraphRow {
        let incoming: Vec<usize> = self
            .lanes
            .iter()
            .enumerate()
            .filter(|(_, slot)| slot.is_some_and(|s| s.expects == id))
            .map(|(i, _)| i)
            .collect();

        let had_incoming = !incoming.is_empty();
        let (node, color) = match incoming.first() {
            Some(&lane) => (lane, self.color_of(lane)),
            None => {
                let lane = self.free_slot();
                let color = self.pick_color();
                self.lanes[lane] = Some(Slot { expects: id, color });
                (lane, color)
            }
        };

        let mut edges = Vec::new();

        // Children side: lanes arriving at, merging into, or passing by this commit.
        for (i, slot) in self.lanes.iter().enumerate() {
            let Some(slot) = slot else { continue };
            if i == node {
                if had_incoming {
                    edges.push(edge(node, node, EdgeKind::In, color));
                }
            } else if slot.expects == id {
                edges.push(edge(i, node, EdgeKind::MergeIn, slot.color));
            } else {
                edges.push(edge(i, i, EdgeKind::Through, slot.color));
            }
        }
        for &lane in incoming.iter().skip(1) {
            self.lanes[lane] = None;
        }

        // Parents side.
        match parents.split_first() {
            None => self.lanes[node] = None,
            Some((&first, rest)) => {
                self.lanes[node] = Some(Slot {
                    expects: first,
                    color,
                });
                edges.push(edge(node, node, EdgeKind::Out, color));

                for (n, &parent) in rest.iter().enumerate() {
                    if parent == first || rest[..n].contains(&parent) {
                        continue;
                    }
                    let waiting = self
                        .lanes
                        .iter()
                        .position(|slot| slot.is_some_and(|s| s.expects == parent));
                    let (lane, lane_color) = match waiting {
                        Some(lane) => (lane, self.color_of(lane)),
                        None => {
                            let lane = self.free_slot();
                            let lane_color = self.pick_color();
                            self.lanes[lane] = Some(Slot {
                                expects: parent,
                                color: lane_color,
                            });
                            (lane, lane_color)
                        }
                    };
                    edges.push(edge(node, lane, EdgeKind::ForkOut, lane_color));
                }
            }
        }

        self.max_width = self.max_width.max(self.lanes.len());
        while self.lanes.last().is_some_and(Option::is_none) {
            self.lanes.pop();
        }

        GraphRow {
            lane: lane_index(node),
            color,
            edges,
        }
    }

    fn color_of(&self, lane: usize) -> u8 {
        self.lanes[lane].map_or(0, |s| s.color)
    }

    /// Lowest free lane, opening a new one on the right if every lane is taken.
    fn free_slot(&mut self) -> usize {
        match self.lanes.iter().position(Option::is_none) {
            Some(lane) => lane,
            None => {
                self.lanes.push(None);
                self.lanes.len() - 1
            }
        }
    }

    /// Lowest palette colour not used by an active lane; rotates when all are taken.
    fn pick_color(&mut self) -> u8 {
        let used = self
            .lanes
            .iter()
            .flatten()
            .fold(0u16, |mask, slot| mask | (1 << slot.color));
        match (0..COLOR_COUNT).find(|c| used & (1 << c) == 0) {
            Some(color) => color,
            None => {
                let color = self.rotate % COLOR_COUNT;
                self.rotate = self.rotate.wrapping_add(1);
                color
            }
        }
    }
}

fn edge(from_lane: usize, to_lane: usize, kind: EdgeKind, color: u8) -> Edge {
    Edge {
        from_lane: lane_index(from_lane),
        to_lane: lane_index(to_lane),
        kind,
        color,
    }
}

fn lane_index(lane: usize) -> u16 {
    u16::try_from(lane).unwrap_or(u16::MAX)
}

/// Checks that consecutive rows fit together: the lanes leaving row `i` are exactly the lanes
/// arriving at row `i + 1` (same lane, same colour), each lane is used once per side (a `ForkOut` may join a lane that already continues), and a
/// commit's own lane is consistent with its `In`/`Out`/`MergeIn` edges.
///
/// Returns how many lanes are still open after the last row (0 for a complete history).
pub fn validate_rows(rows: &[GraphRow]) -> Result<usize, String> {
    use std::collections::BTreeMap;

    let mut open: BTreeMap<u16, u8> = BTreeMap::new();

    for (i, row) in rows.iter().enumerate() {
        let mut before = BTreeMap::new();
        let mut after = BTreeMap::new();
        let mut has_in = false;
        let mut through = Vec::new();

        let put = |map: &mut BTreeMap<u16, u8>, lane: u16, color: u8, what: &str| match map
            .insert(lane, color)
        {
            None => Ok(()),
            Some(_) => Err(format!("row {i}: lane {lane} used twice ({what})")),
        };

        for e in &row.edges {
            match e.kind {
                EdgeKind::Through => {
                    through.push(e.from_lane);
                    put(&mut before, e.from_lane, e.color, "through, before")?;
                    put(&mut after, e.from_lane, e.color, "through, after")?;
                }
                EdgeKind::In => {
                    if e.from_lane != row.lane || e.to_lane != row.lane || e.color != row.color {
                        return Err(format!("row {i}: In edge does not match the commit lane"));
                    }
                    has_in = true;
                    put(&mut before, e.from_lane, e.color, "in")?;
                }
                EdgeKind::MergeIn => {
                    if e.to_lane != row.lane {
                        return Err(format!("row {i}: MergeIn does not end on the commit lane"));
                    }
                    put(&mut before, e.from_lane, e.color, "merge-in")?;
                }
                EdgeKind::Out => {
                    if e.from_lane != row.lane || e.to_lane != row.lane || e.color != row.color {
                        return Err(format!("row {i}: Out edge does not match the commit lane"));
                    }
                    put(&mut after, e.to_lane, e.color, "out")?;
                }
                EdgeKind::ForkOut => {
                    if e.from_lane != row.lane {
                        return Err(format!(
                            "row {i}: ForkOut does not start on the commit lane"
                        ));
                    }
                    // Joining a lane that already continues past this commit is fine, as long as
                    // it is the same lane (same colour); only a clash of different lanes is an error.
                    match after.get(&e.to_lane) {
                        Some(&color) if color == e.color => {}
                        _ => put(&mut after, e.to_lane, e.color, "fork-out")?,
                    }
                }
            }
        }

        if through.contains(&row.lane) {
            return Err(format!(
                "row {i}: a lane passes through the commit's own lane"
            ));
        }
        if has_in != before.contains_key(&row.lane) {
            return Err(format!("row {i}: In edge and arriving lane disagree"));
        }
        if before != open {
            return Err(format!(
                "row {i}: lanes arriving {before:?} differ from lanes left by the previous row {open:?}"
            ));
        }
        open = after;
    }

    Ok(open.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    type Commit = (&'static str, &'static [&'static str]);

    fn layout(history: &[Commit]) -> Vec<GraphRow> {
        let mut layout = LaneLayout::new();
        history
            .iter()
            .map(|(id, parents)| layout.push(*id, parents))
            .collect()
    }

    fn e(from: u16, to: u16, kind: EdgeKind, color: u8) -> Edge {
        Edge {
            from_lane: from,
            to_lane: to,
            kind,
            color,
        }
    }

    fn lanes(rows: &[GraphRow]) -> Vec<u16> {
        rows.iter().map(|r| r.lane).collect()
    }

    #[test]
    fn linear_history_stays_on_one_lane() {
        let rows = layout(&[("c3", &["c2"]), ("c2", &["c1"]), ("c1", &[])]);

        assert_eq!(lanes(&rows), [0, 0, 0]);
        assert_eq!(rows[0].edges, [e(0, 0, EdgeKind::Out, 0)]);
        assert_eq!(
            rows[1].edges,
            [e(0, 0, EdgeKind::In, 0), e(0, 0, EdgeKind::Out, 0)]
        );
        assert_eq!(rows[2].edges, [e(0, 0, EdgeKind::In, 0)]);
        assert_eq!(validate_rows(&rows), Ok(0));
    }

    #[test]
    fn simple_branch_converges_on_the_fork_point() {
        let rows = layout(&[
            ("f2", &["f1"]),
            ("m2", &["m1"]),
            ("f1", &["base"]),
            ("m1", &["base"]),
            ("base", &[]),
        ]);

        assert_eq!(lanes(&rows), [0, 1, 0, 1, 0]);
        assert_eq!(rows[1].edges[0], e(0, 0, EdgeKind::Through, 0));
        // `base` is awaited by lanes 0 and 1: lane 1 merges into lane 0.
        assert_eq!(
            rows[4].edges,
            [e(0, 0, EdgeKind::In, 0), e(1, 0, EdgeKind::MergeIn, 1)]
        );
        assert_eq!(validate_rows(&rows), Ok(0));
    }

    #[test]
    fn merge_commit_forks_out_to_a_new_lane() {
        let rows = layout(&[
            ("M", &["a2", "b2"]),
            ("b2", &["b1"]),
            ("a2", &["a1"]),
            ("b1", &["base"]),
            ("a1", &["base"]),
            ("base", &[]),
        ]);

        assert_eq!(
            rows[0].edges,
            [e(0, 0, EdgeKind::Out, 0), e(0, 1, EdgeKind::ForkOut, 1)]
        );
        // The second parent keeps its own colour along its lane.
        assert_eq!((rows[1].lane, rows[1].color), (1, 1));
        assert_eq!((rows[2].lane, rows[2].color), (0, 0));
        assert_eq!(validate_rows(&rows), Ok(0));
    }

    #[test]
    fn octopus_merge_opens_one_lane_per_extra_parent() {
        let rows = layout(&[
            ("O", &["p0", "p1", "p2", "p3"]),
            ("p0", &["base"]),
            ("p1", &["base"]),
            ("p2", &["base"]),
            ("p3", &["base"]),
            ("base", &[]),
        ]);

        assert_eq!(
            rows[0].edges,
            [
                e(0, 0, EdgeKind::Out, 0),
                e(0, 1, EdgeKind::ForkOut, 1),
                e(0, 2, EdgeKind::ForkOut, 2),
                e(0, 3, EdgeKind::ForkOut, 3),
            ]
        );
        assert_eq!(lanes(&rows), [0, 0, 1, 2, 3, 0]);
        assert_eq!(validate_rows(&rows), Ok(0));
    }

    #[test]
    fn a_fork_reuses_the_lane_already_waiting_for_the_parent() {
        // `m` has `x` as second parent while lane 0 is already waiting for it.
        let rows = layout(&[
            ("s", &["x"]),
            ("m", &["a", "x"]),
            ("a", &["root"]),
            ("x", &["root"]),
            ("root", &[]),
        ]);

        assert_eq!(rows[1].lane, 1);
        assert_eq!(
            rows[1].edges,
            [
                e(0, 0, EdgeKind::Through, 0),
                e(1, 1, EdgeKind::Out, 1),
                e(1, 0, EdgeKind::ForkOut, 0),
            ]
        );
        assert_eq!(validate_rows(&rows), Ok(0));
    }

    #[test]
    fn multiple_roots_free_their_lanes() {
        let rows = layout(&[
            ("a2", &["a1"]),
            ("b2", &["b1"]),
            ("a1", &[]),
            ("c1", &[]),
            ("b1", &[]),
        ]);

        assert_eq!(lanes(&rows), [0, 1, 0, 0, 1]);
        assert_eq!(
            rows[2].edges,
            [e(0, 0, EdgeKind::In, 0), e(1, 1, EdgeKind::Through, 1)]
        );
        assert_eq!(validate_rows(&rows), Ok(0));
    }

    #[test]
    fn a_new_tip_takes_the_lowest_free_colour() {
        let rows = layout(&[
            ("a", &["a0"]),
            ("b", &["b0"]),
            ("a0", &[]),
            ("c", &["c0"]),
            ("b0", &[]),
            ("c0", &[]),
        ]);

        // Lane 0 and colour 0 were released by the root `a0`, so `c` gets them back.
        assert_eq!((rows[3].lane, rows[3].color), (0, 0));
        assert_eq!(validate_rows(&rows), Ok(0));
    }

    #[test]
    fn colours_rotate_when_the_palette_is_exhausted() {
        let tips: Vec<(String, [String; 1])> = (0..10)
            .map(|i| (format!("t{i}"), [format!("p{i}")]))
            .collect();
        let mut layout = LaneLayout::new();
        let rows: Vec<GraphRow> = tips
            .iter()
            .map(|(id, parents)| layout.push(id.as_str(), &[parents[0].as_str()]))
            .collect();

        let colors: Vec<u8> = rows.iter().map(|r| r.color).collect();
        assert_eq!(colors, [0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
        assert_eq!(layout.max_width(), 10);
    }

    #[test]
    fn layout_is_deterministic() {
        let history: &[Commit] = &[
            ("M", &["a", "b", "c"]),
            ("a", &["base"]),
            ("b", &["base"]),
            ("c", &["base"]),
            ("base", &[]),
        ];
        assert_eq!(layout(history), layout(history));
    }

    #[test]
    fn can_be_resumed_after_any_chunk() {
        let history: &[Commit] = &[
            ("M", &["a", "b"]),
            ("b", &["base"]),
            ("a", &["base"]),
            ("base", &[]),
        ];
        let whole = layout(history);

        let mut first_half = LaneLayout::new();
        let mut rows: Vec<GraphRow> = history[..2]
            .iter()
            .map(|(id, p)| first_half.push(*id, p))
            .collect();
        let mut resumed = first_half.clone();
        rows.extend(history[2..].iter().map(|(id, p)| resumed.push(*id, p)));

        assert_eq!(rows, whole);
    }

    #[test]
    fn validate_rows_reports_lanes_left_open() {
        // Only the first two commits of a three-commit history.
        let rows = layout(&[("c3", &["c2"]), ("c2", &["c1"])]);
        assert_eq!(validate_rows(&rows), Ok(1));
    }

    #[test]
    fn validate_rows_rejects_rows_that_do_not_connect() {
        let mut rows = layout(&[("c2", &["c1"]), ("c1", &[])]);
        rows[1].edges.clear();
        assert!(validate_rows(&rows).is_err());
    }
}
