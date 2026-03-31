# Goldilocks — DFT Input Generation

## K-Point Prediction

The goldilocks ML models predict optimal k-point spacing (kdist) for converged
SCF calculations. Two models are available:

- **ALIGNN**: Graph neural network. More accurate, slower (~30s first run due
  to model download). Best for production use.
- **RF**: Random Forest with hand-crafted features. Faster, slightly less
  accurate. Good for quick estimates.

Both return a median prediction and confidence interval at the specified level
(95%, 90%, or 85%). The k-point grid is computed from the lower bound of the
confidence interval to be conservative.

### Interpreting Results

- kdist < 0.15 Å⁻¹: Very fine mesh. Likely a metal or small unit cell.
- kdist 0.15–0.30 Å⁻¹: Typical range for most materials.
- kdist > 0.30 Å⁻¹: Coarse mesh. Large unit cell or well-converged insulator.
- Interval width < 0.08 Å⁻¹: High confidence, trust the prediction.
- Interval width > 0.08 Å⁻¹: Consider running a manual convergence test.

## QE Input File Parameters

### Control Section
- calculation: 'scf' for single-point energy
- pseudo_dir: path to pseudopotential files
- tprnfor: .true. to compute forces

### System Section
- ecutwfc: Wavefunction cutoff from SSSP tables (depends on pseudopotential)
- ecutrho: Density cutoff from SSSP tables
- occupations: 'smearing' with appropriate smearing type
- smearing: 'cold' for metals, 'gaussian' for insulators
- degauss: 0.01 Ry typical starting point

### Electrons Section
- conv_thr: 1e-10 Ry (tight convergence)
- mixing_beta: 0.4 (conservative mixing)
- electron_maxstep: 80

## Common Issues

### SCF not converging
1. Reduce mixing_beta (try 0.2 or 0.1)
2. Increase electron_maxstep
3. Try different mixing_mode ('plain' → 'TF' → 'local-TF')
4. Check if the structure is reasonable (no overlapping atoms)

### K-point prediction seems wrong
1. Check if the structure is correct (primitive vs conventional cell)
2. Compare RF and ALIGNN predictions — if they disagree significantly,
   run a manual convergence test
3. For magnetic materials, predictions may be less reliable

## Pseudopotential Families

The app uses SSSP (Standard Solid-State Pseudopotentials):
- PBEsol functional with efficiency or precision mode
- Cutoffs are looked up from SSSP tables per element
- The maximum cutoff across all elements in the structure is used
