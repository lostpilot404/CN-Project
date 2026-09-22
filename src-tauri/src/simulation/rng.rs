use rand::Rng;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

pub struct DeterministicRng {
    rng: ChaCha8Rng,
    seed: u64,
}

impl DeterministicRng {
    pub fn new(seed: u64) -> Self {
        Self {
            rng: ChaCha8Rng::seed_from_u64(seed),
            seed,
        }
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    pub fn reseed(&mut self, seed: u64) {
        self.seed = seed;
        self.rng = ChaCha8Rng::seed_from_u64(seed);
    }

    pub fn gen_range_f64(&mut self, min: f64, max: f64) -> f64 {
        self.rng.gen_range(min..max)
    }

    pub fn gen_bool(&mut self, p: f64) -> bool {
        self.rng.gen_bool(p.clamp(0.0, 1.0))
    }

    pub fn gen_range_u32(&mut self, min: u32, max: u32) -> u32 {
        self.rng.gen_range(min..=max)
    }
}
