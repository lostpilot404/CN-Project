use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QueueError {
    QueueFull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueSnapshot {
    pub link_id: String,
    pub occupancy: usize,
    pub capacity: usize,
    pub is_transmitting: bool,
    pub total_enqueued: u64,
    pub total_dropped_overflow: u64,
}

#[derive(Debug, Clone)]
pub struct LinkQueue {
    pub link_id: String,
    pub capacity: usize,
    pub buffer: VecDeque<String>, // Stores packet IDs in FIFO order
    pub is_transmitting: bool,
    pub total_enqueued: u64,
    pub total_dropped_overflow: u64,
}

impl LinkQueue {
    pub fn new(link_id: String, capacity: usize) -> Self {
        Self {
            link_id,
            capacity: capacity.max(1),
            buffer: VecDeque::with_capacity(capacity),
            is_transmitting: false,
            total_enqueued: 0,
            total_dropped_overflow: 0,
        }
    }

    /// Enqueue a packet ID. If queue is full, implements drop-tail behavior.
    pub fn enqueue(&mut self, packet_id: String) -> Result<(), QueueError> {
        if self.buffer.len() >= self.capacity {
            self.total_dropped_overflow += 1;
            Err(QueueError::QueueFull)
        } else {
            self.buffer.push_back(packet_id);
            self.total_enqueued += 1;
            Ok(())
        }
    }

    /// Dequeue the head packet ID in FIFO order.
    pub fn dequeue(&mut self) -> Option<String> {
        self.buffer.pop_front()
    }

    /// Peek the head packet ID without removing it.
    pub fn peek(&self) -> Option<&String> {
        self.buffer.front()
    }

    pub fn occupancy(&self) -> usize {
        self.buffer.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
        self.is_transmitting = false;
        self.total_enqueued = 0;
        self.total_dropped_overflow = 0;
    }

    pub fn get_snapshot(&self) -> QueueSnapshot {
        QueueSnapshot {
            link_id: self.link_id.clone(),
            occupancy: self.buffer.len(),
            capacity: self.capacity,
            is_transmitting: self.is_transmitting,
            total_enqueued: self.total_enqueued,
            total_dropped_overflow: self.total_dropped_overflow,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queue_fifo_and_overflow() {
        let mut q = LinkQueue::new("link-1".to_string(), 3);
        assert_eq!(q.occupancy(), 0);
        assert!(q.is_empty());

        assert!(q.enqueue("pkt-1".to_string()).is_ok());
        assert!(q.enqueue("pkt-2".to_string()).is_ok());
        assert!(q.enqueue("pkt-3".to_string()).is_ok());
        assert_eq!(q.occupancy(), 3);

        // 4th packet exceeds capacity 3 -> Drop-Tail
        assert_eq!(q.enqueue("pkt-4".to_string()), Err(QueueError::QueueFull));
        assert_eq!(q.total_dropped_overflow, 1);
        assert_eq!(q.occupancy(), 3);

        // FIFO order check
        assert_eq!(q.dequeue(), Some("pkt-1".to_string()));
        assert_eq!(q.dequeue(), Some("pkt-2".to_string()));
        assert_eq!(q.occupancy(), 1);

        // Enqueue after space freed
        assert!(q.enqueue("pkt-5".to_string()).is_ok());
        assert_eq!(q.dequeue(), Some("pkt-3".to_string()));
        assert_eq!(q.dequeue(), Some("pkt-5".to_string()));
        assert_eq!(q.dequeue(), None);
        assert!(q.is_empty());
    }
}
