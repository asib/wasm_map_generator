mod utils;

use wasm_bindgen::prelude::*;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

use noise::{Seedable, NoiseFn, OpenSimplex, Perlin};
use lerp::Lerp;

#[wasm_bindgen]
pub struct NoiseMap {
    width: usize,
    height: usize,
    scale: f64,
    octaves: u8,
    lacunarity: f64,
    persistence: f64,
    max_value: f64,
    min_value: f64,
    map: Vec<f64>,
    vertices: Vec<f32>,
}

fn euclidean_distance(p1: (f64, f64), p2: (f64, f64)) -> f64 {
    ((p1.0 - p2.0).powi(2) + (p1.1 - p2.1).powi(2)).sqrt()
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a * (1.0 - t) + b * t
}

fn invlerp(a: f64, b: f64, v: f64) -> f64 {
    clamp((v - a) / (b - a), 0.0, 1.0)
}

fn clamp(v: f64, min: f64, max: f64) -> f64 {
    max.min(min.max(v))
}

#[wasm_bindgen]
impl NoiseMap {
    pub fn new(
        width: usize,
        height: usize,
        scale: f64,
        octaves: u8,
        lacunarity: f64,
        persistence: f64,
        reshape: bool,
    ) -> NoiseMap {
        utils::set_panic_hook();

        let (center_x, center_y) = (width as f64 / 2.0, height as f64 / 2.0);
        let max_distance_from_center = euclidean_distance((0.0, 0.0),
            (center_x, center_y));

        let noise = Perlin::new();
        noise.set_seed(rand::random());

        let mut noise_map = Vec::with_capacity(height);
        let mut max_value = std::f64::MIN;
        let mut min_value = std::f64::MAX;

        for y in 0..height {
            let mut row = Vec::with_capacity(width);
            for x in 0..width {
                let mut noise_val = 0_f64;
                for octave_idx in 0..octaves {
                    let octave_idx = octave_idx as i32;
                    let sample_x = x as f64 / scale * lacunarity.powi(octave_idx);
                    let sample_y = y as f64 / scale * lacunarity.powi(octave_idx);
                    noise_val += noise.get([sample_x, sample_y]) * persistence.powi(octave_idx);
                }

                if reshape {
                    let distance_to_map_center = euclidean_distance((x as f64, y as f64),
                      (center_x, center_y));
                    let d = invlerp(0.0, max_distance_from_center, distance_to_map_center);
                    let d = -lerp(-1.0, 1.0, d);
                    noise_val = clamp(noise_val + d, 0.0, 1.0);
                }

                row.push(noise_val);

                if noise_val > max_value {
                    max_value = noise_val;
                } else if noise_val < min_value {
                    min_value = noise_val;
                }
            }

            noise_map.push(row);
        }

        NoiseMap {
            width,
            height,
            scale,
            octaves,
            lacunarity,
            persistence,
            max_value,
            min_value,
            map: noise_map.concat(), // flatten the 2D into a 1D for WASM interop.
            // 2 triangles per vertex, 3 points per triangle, 3 floats per point,
            // gives factor of 18
            vertices: Vec::with_capacity(18 * (width-1) * (height-1)),
        }
    }

    pub fn gen_vertices(&mut self) {
        for x in 0..self.width-1 {
            for y in 0..self.height-1 {
                let fx = x as f32;
                let fy = y as f32;
                let ix = self.get_index(x, y);

                let scale = 200.0;

                let scale_lerp = |x, y| {
                    lerp(0.0, scale, invlerp(self.min_value, self.max_value,
                            self.map[self.get_index(x, y)])) as f32
                };

                let current = [fx, fy, scale_lerp(x, y)];
                let east = [fx+1.0, fy, scale_lerp(x+1, y)];
                let south = [fx, fy+1.0, scale_lerp(x, y+1)];
                let southeast = [fx+1.0, fy+1.0, scale_lerp(x+1, y+1)];

                self.vertices.extend_from_slice(&([current, east, south, south, east, southeast]).concat());
            }
        }
    }

    fn get_coord(&self, ix: usize) -> (usize, usize) {
        (ix / self.width, ix % self.width)
    }

    fn get_index(&self, x: usize, y: usize) -> usize {
        y * self.width + x
    }

    pub fn width(&self) -> usize { self.width }
    pub fn height(&self) -> usize { self.height }
    pub fn scale(&self) -> f64 { self.scale }
    pub fn octaves(&self) -> u8 { self.octaves }
    pub fn lacunarity(&self) -> f64 { self.lacunarity }
    pub fn persistence(&self) -> f64 { self.persistence }
    pub fn noise_map(&self) -> *const f64 { self.map.as_ptr() }
    pub fn vertices(&self) -> *const f32 { self.vertices.as_ptr() }
    pub fn max_value(&self) -> f64 { self.max_value }
    pub fn min_value(&self) -> f64 { self.min_value }
}

pub fn write_grid_to_file(grid: &[Vec<f64>], path: &str) -> std::io::Result<()> {
    let file = std::fs::File::create(path)?;
    let png_encoder = image::png::PNGEncoder::new(file);
    let width = grid[0].len();
    let height = grid.len();
    let mut lerp_grid = Vec::with_capacity(height);
    for i in 0..height {
        let mut row = Vec::with_capacity(width);
        for j in 0..width {
            let val = 128_f64.lerp(255.0, grid[j][i]);
            row.push(val as u8);
        }
        lerp_grid.push(row);
    }
    png_encoder.encode(&lerp_grid.concat(),
                       grid[0].len() as u32,
                       grid.len() as u32,
                       image::ColorType::Gray(8))
}
