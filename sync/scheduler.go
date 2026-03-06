package sync

import (
	"log"
	"time"
)

// Scheduler handles periodic sync tasks
type Scheduler struct {
	Git      *GitManager
	Interval time.Duration
	stop     chan struct{}
}

// NewScheduler creates a new background scheduler
func NewScheduler(git *GitManager, interval time.Duration) *Scheduler {
	if interval < 1*time.Minute {
		interval = 5 * time.Minute // Default to 5 mins if too short
	}
	return &Scheduler{
		Git:      git,
		Interval: interval,
		stop:     make(chan struct{}),
	}
}

// Start begins the periodic sync
func (s *Scheduler) Start() {
	log.Printf("Git Sync: Starting background scheduler (interval: %v)", s.Interval)
	ticker := time.NewTicker(s.Interval)
	go func() {
		for {
			select {
			case <-ticker.C:
				if err := s.Git.Sync(); err != nil {
					log.Printf("Git Sync Error: %v", err)
				}
			case <-s.stop:
				ticker.Stop()
				return
			}
		}
	}()
}

// Stop stops the scheduler
func (s *Scheduler) Stop() {
	close(s.stop)
}
