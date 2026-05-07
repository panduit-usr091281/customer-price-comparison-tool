const defaultLabor = {
  electrician: 31.11,
  lvTech: 28.51,
  design: 51.43,
  designer: 35.44,
  laborer: 22.47,
};

const DESIGN_PHASES = new Set([
  "1) Design and Engineering",
  "2) Permitting and Preconstruction",
]);

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function num(value, digits = 1) {
  return Number(value).toFixed(digits);
}

function whole(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createLineItem({
  phase,
  activity,
  description,
  quantity,
  unit,
  laborUnits,
  laborRate,
  laborRole,
  materials,
  milestone,
}) {
  const laborHours = quantity * laborUnits;
  return {
    phase,
    activity,
    description,
    quantity,
    unit,
    laborUnits,
    laborHours,
    laborRate,
    laborRole,
    materials,
    milestone,
  };
}

function material(name, qty, unit, unitCost) {
  return { name, qty, unit, unitCost };
}

function electricalCableRate(powerW, distanceFt) {
  // AWG sizing is primarily power/amperage-driven
  // Distance adds one size bump if voltage drop is a concern (>300ft)
  const longRun = distanceFt > 300;
  if (powerW <= 500) return { awg: longRun ? "#10" : "#12", rate: longRun ? 0.45 : 0.35 };
  if (powerW <= 1500) return { awg: longRun ? "#8" : "#10", rate: longRun ? 0.75 : 0.45 };
  if (powerW <= 3000) return { awg: longRun ? "#6" : "#8", rate: longRun ? 1.10 : 0.75 };
  if (powerW <= 5000) return { awg: "#4", rate: 1.65 };
  if (powerW <= 10000) return { awg: "#1", rate: 3.20 };
  return { awg: "4/0", rate: 5.50 };
}

// AC conduit defaults to 2" for all power tiers; user may override the size
// when the installation is outdoor (handled via the outdoorConduitSize input).
function conduitRate(powerW, sizeOverride) {
  // All-in material rate includes pipe, fittings, straps, couplings, connectors, and supports.
  // Labor is install pace only. Target: ~$18/ft installed for 2" EMT.
  const sizes = {
    '3/4"':   { size: '3/4"',   rate: 6.50,  laborPerFt: 0.06 },
    '1"':     { size: '1"',     rate: 8.50,  laborPerFt: 0.08 },
    '1-1/4"': { size: '1-1/4"', rate: 11.00, laborPerFt: 0.10 },
    '2"':     { size: '2"',     rate: 13.64, laborPerFt: 0.14 },
    '4"':     { size: '4"',     rate: 28.00, laborPerFt: 0.22 },
  };
  if (sizeOverride && sizes[sizeOverride]) return sizes[sizeOverride];
  return sizes['2"']; // default for all AC power
}

// Conductor count: 1-phase (≤2000W) = 3 wires (H+N+G), 3-phase (>2000W) = 5 wires (3P+N+G)
function conductorCount(powerW) {
  return powerW <= 2000 ? 3 : 5;
}

const STANDARD_BREAKER_AMPS = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400];

function nextStandardBreaker(requiredAmps) {
  return STANDARD_BREAKER_AMPS.find((amp) => amp >= requiredAmps) || STANDARD_BREAKER_AMPS[STANDARD_BREAKER_AMPS.length - 1];
}

function estimateACCircuitCapacity(powerW) {
  const isThreePhase = powerW > 2000;
  const voltage = isThreePhase ? 208 : 120;
  const requiredAmps = isThreePhase
    ? powerW / (Math.sqrt(3) * voltage)
    : powerW / voltage;
  const breakerAmps = nextStandardBreaker(requiredAmps * 1.25);
  const totalW = isThreePhase
    ? Math.sqrt(3) * voltage * breakerAmps * 0.8
    : voltage * breakerAmps * 0.8;

  return {
    applicable: true,
    usedW: powerW,
    totalW,
    remainingW: Math.max(0, totalW - powerW),
    basis: `${breakerAmps}A ${isThreePhase ? "208V 3-phase" : "120V 1-phase"} circuit`,
    note: "Standard breaker sizing with 80% continuous-load usable capacity.",
  };
}

// Pull boxes required per NEC (~1 per 100ft of conduit run)
function pullBoxCount(conduitFt) {
  return Math.max(0, Math.ceil(conduitFt / 100) - 1);
}

// Trenching cost model based on depth and conduit size
// CL1 Power: 30-36" depth; LV (CL2/CL4): 18-24" depth
// Data from production rate tables (midpoint of ranges)
// Returns {rate, laborPerFt, description} or null if no trenching needed
function trenchingSpec(installationType, outdoorType, archType, conduitSize) {
  const needsTrench = (installationType === "outdoor" || installationType === "mixed") &&
    (outdoorType === "direct-bury" || outdoorType === "conduit-bury" || outdoorType === "underground-duct");
  if (!needsTrench) return null;

  // Trenching uses the LOW end of published production-rate ranges (best-case scheduling)
  // and the LOW end of cost ranges. Cost-per-ft is appended to the description for reference.
  // LV trenching (18-24" depth) — for CL2 and CL4
  const lvTrench = {
    "micro":       { rate: 20.00, laborPerFt: 0.15 / 60, description: "18\" micro-trench, direct burial LV cable @ $20/ft (low-range reference)" },
    "direct-bury": { rate: 12.00, laborPerFt: 0.5 / 60,  description: "24\" trench, sand bedding, direct burial LV cable, and backfill @ $12/ft (low-range reference)" },
    "1/2-conduit": { rate: 15.00, laborPerFt: 0.7 / 60,  description: "24\" trench, 1/2\" conduit placement, and backfill @ $15/ft (low-range reference)" },
    "1-conduit":   { rate: 18.00, laborPerFt: 0.9 / 60,  description: "24\" trench, 1\" conduit placement, and backfill @ $18/ft (low-range reference)" },
    "2-conduit":   { rate: 22.00, laborPerFt: 1.5 / 60,  description: "24\" trench, 2\" conduit/duct, and backfill @ $22/ft (low-range reference)" },
  };

  // CL1 Power trenching (30-36" depth) — earthwork only; conduit is a separate line item
  const powerTrench = {
    "direct-bury": { rate: 18.00, laborPerFt: 0.5 / 60,  description: "36\" trench, sand bedding, direct burial power cable, and backfill @ $18/ft (low-range reference)" },
    "1-conduit":   { rate: 20.00, laborPerFt: 0.9 / 60,  description: "36\" trench, bedding, and backfill — conduit material billed separately @ $20/ft (low-range reference)" },
    "2-conduit":   { rate: 22.00, laborPerFt: 1.5 / 60,  description: "36\" trench, bedding, and backfill — conduit material billed separately @ $22/ft (low-range reference)" },
    "4-conduit":   { rate: 25.00, laborPerFt: 2.5 / 60,  description: "36\" wide trench, bedding, and backfill — conduit material billed separately @ $25/ft (low-range reference)" },
  };

  if (archType === "ac") {
    // AC: select trench type by outdoor type and conduit size
    if (outdoorType === "direct-bury") return powerTrench["direct-bury"];
    // Map conduit size to trench spec
    const sizeKey = (conduitSize === '3/4"' || conduitSize === '1"') ? "1-conduit"
      : (conduitSize === '1-1/4"' || conduitSize === '2"') ? "2-conduit"
      : "4-conduit";
    return powerTrench[sizeKey];
  }

  // CL2 / CL4: low-voltage depth
  if (outdoorType === "direct-bury") return lvTrench["direct-bury"];
  if (outdoorType === "conduit-bury") return lvTrench["1-conduit"];
  // underground-duct
  return lvTrench["2-conduit"];
}

function calculateAC(powerW, distanceFt, labor, crewSize, conduitCostOverride, installationType, outdoorType, outdoorConduitSize) {
  const { awg, rate } = electricalCableRate(powerW, distanceFt);
  // Outdoor (or mixed) installations may override conduit size; otherwise default 2"
  const conduitSizeOverride = (installationType === "outdoor" || installationType === "mixed")
    ? outdoorConduitSize
    : null;
  const { size: conduitSize, rate: conduitCostPerFt, laborPerFt: conduitLaborPerFt } = conduitRate(powerW, conduitSizeOverride);
  const wireCount = conductorCount(powerW);
  const conduitFt = distanceFt * 1.15;
  const cableFt = distanceFt * 1.18;
  const pullBoxQty = pullBoxCount(conduitFt);
  const coreDrillQty = Math.max(1, Math.ceil(distanceFt / 150));

  // If user provides conduit cost override (> 0), use as all-in $/ft (labor + material)
  const useConduitOverride = conduitCostOverride > 0;
  const conduitAllInPerFt = useConduitOverride ? conduitCostOverride : conduitCostPerFt;
  const conduitLaborHrsPerFt = useConduitOverride ? 0 : conduitLaborPerFt;

  // Equipment tier logic:
  // Simple: short run, low power — conduit + receptacle only
  // Standard: medium run or medium power — breaker in existing panel, no transformer/new panels
  // Full: long run or high power — transformer + new panels + full MER equipment
  const isSimple = distanceFt < 260 && powerW < 2000;
  const isFull = powerW > 10000 || distanceFt > 800;

  const lineItems = [
    createLineItem({
      phase: "1) Design and Engineering",
      activity: "Power design package",
      description: isSimple
        ? "Site walk, circuit identification, and routing plan"
        : "Site walk, panel audit, code review, and BIM coordination",
      quantity: 1,
      unit: "lot",
      laborUnits: isSimple ? 12 : Math.max(14, 6 + distanceFt / 500 + powerW / 1800),
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "Design package complete",
    }),
    ...(isSimple ? [] : [createLineItem({
      phase: "1) Design and Engineering",
      activity: "Submittals and coordination drawings",
      description: "Submittals, procurement log, BIM/coordination if required",
      quantity: 1,
      unit: "lot",
      laborUnits: isFull ? 12 : 10,
      laborRate: labor.designer,
      laborRole: "Electrical Designer",
      materials: [],
      milestone: "Submittals approved",
    })]),
    createLineItem({
      phase: "2) Permitting and Preconstruction",
      activity: "Pre-design survey",
      description: "Site verification, panel access, pathway confirmation, and trade coordination",
      quantity: 1,
      unit: "lot",
      laborUnits: 5,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "Pre-design survey complete",
    }),
    createLineItem({
      phase: "2) Permitting and Preconstruction",
      activity: "Permit and inspection coordination",
      description: isSimple
        ? "Permit notification and simple plan check"
        : "Permit prep, utility review, and AHJ coordination",
      quantity: 1,
      unit: "lot",
      laborUnits: isSimple ? 8 : Math.max(16, 8 + distanceFt / 1000),
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [material("Permit allowance", 1, "lot", isSimple ? 150 : 500)],
      milestone: "Permit package submitted",
    }),
    ...(isSimple ? [] : [
      createLineItem({
        phase: "2) Permitting and Preconstruction",
        activity: "AHJ review and plan check period",
        description: "Plan check review, responses, resubmittals, and approval wait time (schedule duration only)",
        quantity: 1,
        unit: "lot",
        laborUnits: Math.max(84, 60 + distanceFt / 500),
        laborRate: 0,
        laborRole: "Wait Time",
        materials: [],
        milestone: "Permit approved",
      }),
      createLineItem({
        phase: "2) Permitting and Preconstruction",
        activity: "Mobilization and safety plan",
        description: "Safety plan, daily cleanup, project admin",
        quantity: 1,
        unit: "lot",
        laborUnits: isFull ? 16 : 12,
        laborRate: labor.design,
        laborRole: "Design/PM",
        materials: [],
        milestone: "Mobilization complete",
      }),
    ]),
    createLineItem({
      phase: "3) Pathway and Distribution Build",
      activity: `Conduit installation (${conduitSize} EMT)`,
      description: isSimple
        ? "Install branch conduit from existing panel to endpoint"
        : "Install feeder conduit path from source to endpoint",
      quantity: conduitFt,
      unit: "ft",
      // Override zeros conduit labor regardless of tier (treated as installed cost)
      laborUnits: useConduitOverride ? 0 : (isSimple ? 0.05 : conduitLaborHrsPerFt),
      laborRate: labor.electrician,
      laborRole: "Electrician",
      materials: [material(`Conduit ${conduitSize} EMT w/ fittings & supports${useConduitOverride ? " (installed)" : ""}`, conduitFt, "ft", conduitAllInPerFt)],
      milestone: "Conduit complete",
    }),
    ...(pullBoxQty > 0 ? [createLineItem({
      phase: "3) Pathway and Distribution Build",
      activity: "Pull boxes and junction boxes",
      description: "Install pull boxes and junction boxes per NEC bend/length limits",
      quantity: pullBoxQty,
      unit: "ea",
      laborUnits: 1.75,
      laborRate: labor.electrician,
      laborRole: "Electrician",
      materials: [material("Pull boxes / junction boxes", pullBoxQty, "ea", 250)],
      milestone: "Pull boxes installed",
    })] : []),
    ...(isSimple ? [] : [createLineItem({
      phase: "3) Pathway and Distribution Build",
      activity: "Core drilling, wall penetrations, and firestopping",
      description: "Core drill penetrations, wall penetrations, and UL firestop systems",
      quantity: coreDrillQty,
      unit: "ea",
      laborUnits: 1.6,
      laborRate: labor.laborer,
      laborRole: "Construction Laborer",
      materials: [material("Core drill + penetration + firestop materials", coreDrillQty, "ea", 75)],
      milestone: "Penetrations complete",
    })]),
    ...(() => {
      const trench = trenchingSpec(installationType, outdoorType, "ac", conduitSize);
      if (!trench) return [];
      return [createLineItem({
        phase: "3) Pathway and Distribution Build",
        activity: "Trenching and earthwork",
        description: trench.description,
        quantity: conduitFt,
        unit: "ft",
        laborUnits: trench.laborPerFt,
        laborRate: labor.laborer,
        laborRole: "Construction Laborer",
        materials: [material("Trenching materials and backfill", conduitFt, "ft", trench.rate)],
        milestone: "Trench complete",
      })];
    })(),
    ...(isSimple ? [] : [createLineItem({
      phase: "3) Pathway and Distribution Build",
      activity: "Grounding and bonding",
      description: "Bushings, jumpers, ground bar for conduit system",
      quantity: 1,
      unit: "lot",
      laborUnits: 4,
      laborRate: labor.electrician,
      laborRole: "Electrician",
      materials: [material("Grounding and bonding materials", 1, "lot", 200)],
      milestone: "Grounding complete",
    })]),
    // Phase 4 — Equipment tier determines what gets installed
    ...(isSimple ? [
      // Simple: just a receptacle/junction at the endpoint
      createLineItem({
        phase: "4) Power Equipment Install",
        activity: "Receptacle and device installation",
        description: "Install receptacle, cover, and breaker in existing panel",
        quantity: 1,
        unit: "ea",
        laborUnits: 1.5,
        laborRate: labor.electrician,
        laborRole: "Electrician",
        materials: [material("Receptacle, box, cover, and breaker", 1, "ea", 45)],
        milestone: "Device installed",
      }),
    ] : isFull ? [
      // Full buildout: new panelboard + transformer + feeder breaker
      createLineItem({
        phase: "4) Power Equipment Install",
        activity: "Panelboard installation",
        description: "Set panelboard, main breaker, and protection devices",
        quantity: 1,
        unit: "ea",
        laborUnits: 10,
        laborRate: labor.electrician,
        laborRole: "Electrician",
        materials: [material("Panelboard assembly", 1, "lot", powerW <= 5000 ? 1200 : 2500)],
        milestone: "Panel set",
      }),
      createLineItem({
        phase: "4) Power Equipment Install",
        activity: "Transformer installation",
        description: "Dry-type transformer 480→208/120V with vibration pads",
        quantity: 1,
        unit: "ea",
        laborUnits: 16,
        laborRate: labor.electrician,
        laborRole: "Electrician",
        materials: [material("Dry-type transformer", 1, "ea", 4500)],
        milestone: "Transformer set",
      }),
      createLineItem({
        phase: "4) Power Equipment Install",
        activity: "Feeder breaker in source gear",
        description: "Install feeder breaker in MER/source gear",
        quantity: 1,
        unit: "ea",
        laborUnits: 6,
        laborRate: labor.electrician,
        laborRole: "Electrician",
        materials: [material("Feeder breaker assembly", 1, "ea", 2500)],
        milestone: "Feeder breaker installed",
      }),
    ] : [
      // Standard: feeder breaker in existing gear only (no new panel, no transformer)
      createLineItem({
        phase: "4) Power Equipment Install",
        activity: "Breaker installation in existing panel",
        description: "Install breaker in existing panelboard for new circuit",
        quantity: 1,
        unit: "ea",
        laborUnits: 3,
        laborRate: labor.electrician,
        laborRole: "Electrician",
        materials: [material("Circuit breaker", 1, "ea", powerW <= 2000 ? 30 : 250)],
        milestone: "Breaker installed",
      }),
    ]),
    createLineItem({
      phase: "5) Cable Installation and Termination",
      activity: isSimple
        ? `Branch conductor pull (${awg} × ${wireCount} wires)`
        : `Feeder conductor pull (${awg} × ${wireCount} wires)`,
      description: isSimple
        ? "Pull and route branch conductors to endpoint"
        : "Pull, route, and support feeder conductors",
      quantity: cableFt,
      unit: "ft",
      laborUnits: isSimple ? 0.03 : (powerW > 5000 ? 0.06 : 0.04),
      laborRate: labor.electrician,
      laborRole: "Electrician",
      materials: [material(`Conductors ${awg} (${wireCount}-wire bundle)`, cableFt, "ft", rate * wireCount)],
      milestone: "Cable pull complete",
    }),
    createLineItem({
      phase: "5) Cable Installation and Termination",
      activity: "Termination and labeling",
      description: "Terminate circuits, torque connections, apply labels",
      quantity: 1,
      unit: "lot",
      laborUnits: isSimple ? 1.5 : (4 + powerW / 3000),
      laborRate: labor.electrician,
      laborRole: "Electrician",
      materials: [material("Labeling and consumables", 1, "lot", isSimple ? 35 : 250)],
      milestone: "Terminations complete",
    }),
    ...(isSimple ? [] : [createLineItem({
      phase: "5) Cable Installation and Termination",
      activity: "Panel schedules and circuit directories",
      description: "Final typed panel directories",
      quantity: 1,
      unit: "lot",
      laborUnits: isFull ? 8 : 4,
      laborRate: labor.designer,
      laborRole: "Electrical Designer",
      materials: [],
      milestone: "Directories complete",
    })]),
    ...(isSimple ? [
      // Simple tier: basic circuit test and closeout
      createLineItem({
        phase: "6) Testing and Commissioning",
        activity: "Circuit verification and closeout",
        description: "Verify circuit continuity, polarity, and document",
        quantity: 1,
        unit: "lot",
        laborUnits: 2,
        laborRate: labor.electrician,
        laborRole: "Electrician",
        materials: [],
        milestone: "Project closed",
      }),
    ] : [
      createLineItem({
        phase: "6) Testing and Commissioning",
        activity: "Megger and insulation testing",
        description: "Megger feeders and critical circuits, insulation resistance",
        quantity: 1,
        unit: "lot",
        laborUnits: isFull ? 12 : 4,
        laborRate: labor.electrician,
        laborRole: "Electrician",
        materials: [material("Testing consumables", 1, "lot", 80)],
        milestone: "Megger testing complete",
      }),
      ...(isFull ? [createLineItem({
        phase: "6) Testing and Commissioning",
        activity: "Torque verification",
        description: "Torque all terminations per manufacturer spec, document values",
        quantity: 1,
        unit: "lot",
        laborUnits: 8,
        laborRate: labor.electrician,
        laborRole: "Electrician",
        materials: [],
        milestone: "Torque verification complete",
      })] : []),
      createLineItem({
        phase: "6) Testing and Commissioning",
        activity: "Functional performance testing",
        description: "End-to-end load verification, controls checkout, energization sequence",
        quantity: 1,
        unit: "lot",
        laborUnits: isFull ? 10 : 4,
        laborRate: labor.electrician,
        laborRole: "Electrician",
        materials: [],
        milestone: "Functional test complete",
      }),
      createLineItem({
        phase: "6) Testing and Commissioning",
        activity: "Closeout and owner handoff",
        description: "As-builts, O&M package, training, and owner walkthrough",
        quantity: 1,
        unit: "lot",
        laborUnits: isFull ? 18 : 8,
        laborRate: labor.design,
        laborRole: "Design/PM",
        materials: [],
        milestone: "Project closed",
      }),
      ...(isFull ? [createLineItem({
        phase: "6) Testing and Commissioning",
        activity: "Punchlist corrections",
        description: "Final walk and punchlist resolution",
        quantity: 1,
        unit: "lot",
        laborUnits: 16,
        laborRate: labor.design,
        laborRole: "Design/PM",
        materials: [],
        milestone: "Punchlist closed",
      })] : []),
    ]),
  ];

  const scenario = summarize("Class 1 AC", lineItems, {
    fit: distanceFt <= 150 || powerW > 10000 ? "good" : "warn",
    fitText:
      distanceFt <= 150
        ? "Strong fit for short runs"
        : powerW > 10000
        ? "Required for very high power loads"
        : "Higher cost and time as distance grows",
  }, crewSize);

  scenario.capacity = estimateACCircuitCapacity(powerW);
  scenario.capacity.totalLabel = "Circuit Capacity";
  return scenario;
}

function calculateClass2(powerW, distanceFt, labor, crewSize, installationType, outdoorType) {
  if (distanceFt > 1750) {
    const scenario = {
      name: "Class 2 DC",
      rows: [],
      totalCost: 0,
      totalHours: 0,
      totalDays: 0,
      designDays: 0,
      installDays: 0,
      crewSize,
      fit: "bad",
      fitText: "Distance exceeds Class 2 limit (1750 ft) — not applicable",
      materialTotal: 0,
      laborTotal: 0,
      isApplicable: false,
      unavailabilityReason: "Distance exceeds Class 2 limit (1750 ft) — not applicable",
      unavailabilityShortText: "Distance > 1,750 ft",
      capacity: {
        applicable: false,
        usedW: powerW,
        totalW: 0,
        remainingW: 0,
        basis: "Class 2 distance limit exceeded",
        note: "Class 2 power is not calculated beyond 1,750 ft. Reduce distance or use a different architecture.",
        ariaLabel: "CL2 DC future capacity is unavailable because the requested run exceeds the 1,750 foot Class 2 distance limit.",
        stats: [
          { label: "Requested", value: `${whole(powerW)} W` },
          { label: "Available", value: "N/A" },
          { label: "Limit", value: "1,750 ft max" },
        ],
      },
    };
    return scenario;
  }

  const cl2Dist = distanceFt;

  // Class 2: 60VDC system, 50V minimum at load → 10V max voltage drop
  // Current per pair at full load: 100W / 60V = 1.667A
  // Vdrop = I × 2 × R_per_ft × distance ≤ 10V
  // Copper resistance per foot (solid conductor):
  //   18AWG: 0.006385 Ω/ft
  //   16AWG: 0.004016 Ω/ft
  //   14AWG: 0.002525 Ω/ft
  //   12AWG: 0.001588 Ω/ft
  const maxVdrop = 10; // 60V - 50V minimum
  const currentPerPair = 100 / 60; // 1.667A

  // AWG sizing by distance; CL2 max = 1750ft
  function class2CableSpec(dist) {
    if (dist <= 300) return { awg: "18", rate: 0.20, ohmsPerFt: 0.006385 };
    if (dist <= 550) return { awg: "16", rate: 0.33, ohmsPerFt: 0.004016 };
    if (dist <= 900) return { awg: "14", rate: 0.55, ohmsPerFt: 0.002525 };
    return { awg: "12", rate: 0.70, ohmsPerFt: 0.001588 };
  }

  const { awg: cl2AWG, rate: cl2CableRate, ohmsPerFt } = class2CableSpec(cl2Dist);

  // Actual voltage drop at full load for reporting
  const actualVdrop = currentPerPair * 2 * ohmsPerFt * cl2Dist;

  // Class 2 pairs: each pair sources 100W but delivers less due to voltage drop
  // Effective delivered watts per pair = (60V - actualVdrop) × I_per_pair
  // If Vdrop would exceed 10V at full current, limit current to stay within budget
  let effectiveWattsPerPair;
  if (actualVdrop <= maxVdrop) {
    effectiveWattsPerPair = (60 - actualVdrop) * currentPerPair;
  } else {
    const maxCurrent = maxVdrop / (2 * ohmsPerFt * cl2Dist);
    effectiveWattsPerPair = (60 - maxVdrop) * maxCurrent;
  }
  const pairs = Math.max(1, Math.ceil(powerW / effectiveWattsPerPair));
  const conductorsPerPair = 2;
  const totalConductors = pairs * conductorsPerPair;

  // Economy of scale: up to 8 conductors pulled simultaneously
  const pullGroups = Math.ceil(totalConductors / 8);
  // Labor rate per foot decreases with more conductors in a group
  const conductorsInLastGroup = totalConductors - (pullGroups - 1) * 8;
  const avgConductorsPerPull = totalConductors / pullGroups;
  // Base labor: 1/110 hrs/ft for a single conductor; 8 conductors together = ~60% of individual pulls
  const pullEfficiency = 1 - (avgConductorsPerPull - 1) * 0.057; // 8 conductors → ~0.60 factor
  const laborPerFtPerGroup = (1 / 110) * Math.max(0.55, pullEfficiency);

  const pathwayFt = cl2Dist * 1.05;
  const cablePairFt = pairs * cl2Dist * 1.1; // total pair-feet with 10% slack
  const cableFt = totalConductors * cl2Dist * 1.1; // total conductor-feet (for labor calc)
  const pullLaborHrs = pullGroups * cl2Dist * 1.1 * laborPerFtPerGroup;

  const injectorQty = Math.max(1, Math.ceil(pairs / 4));
  const dcHubQty = Math.max(1, Math.ceil(pairs / 10));
  const jHookQty = Math.ceil(pathwayFt / 6);
  const penetrationQty = Math.max(1, Math.ceil(cl2Dist / 200));

  const lineItems = [
    createLineItem({
      phase: "1) Design and Engineering",
      activity: "Low-voltage system design",
      description: "Class 2 run balancing, port map, and labeling plan",
      quantity: 1,
      unit: "lot",
      laborUnits: 4 + pairs * 0.4,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "LV design complete",
    }),
    createLineItem({
      phase: "1) Design and Engineering",
      activity: "Submittals and procurement",
      description: "Equipment submittals, procurement log, review cycles",
      quantity: 1,
      unit: "lot",
      laborUnits: 4,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [],
      milestone: "Submittals approved",
    }),
    createLineItem({
      phase: "2) Permitting and Preconstruction",
      activity: "Pre-design survey",
      description: "Site verification, access windows, and trade coordination",
      quantity: 1,
      unit: "lot",
      laborUnits: 3 + cl2Dist / 1200,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "Pre-design survey complete",
    }),
    createLineItem({
      phase: "2) Permitting and Preconstruction",
      activity: "AHJ package and plan/pathway review",
      description: "Code package prep, AHJ coordination, plan/pathway review, and installation sequencing",
      quantity: 1,
      unit: "lot",
      laborUnits: 3,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [material("Permit allowance", 1, "lot", 250)],
      milestone: "AHJ package issued",
    }),
    createLineItem({
      phase: "2) Permitting and Preconstruction",
      activity: "Mobilization and safety plan",
      description: "Safety plan, material staging, project admin",
      quantity: 1,
      unit: "lot",
      laborUnits: 6,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "Mobilization complete",
    }),
    createLineItem({
      phase: "3) Pathway and Distribution Build",
      activity: "J-hook and pathway support installation",
      description: "Install J-hooks, cable tray, and supports for CL2 routes",
      quantity: pathwayFt,
      unit: "ft",
      laborUnits: 1 / 110,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("J-hooks and pathway supports", jHookQty, "ea", 4.5)],
      milestone: "Pathway supports installed",
    }),
    createLineItem({
      phase: "3) Pathway and Distribution Build",
      activity: "Core drilling, wall penetrations, and firestopping",
      description: "Core drill, wall penetrations, and UL firestop for LV pathway",
      quantity: penetrationQty,
      unit: "ea",
      laborUnits: 0.85,
      laborRate: labor.laborer,
      laborRole: "Construction Laborer",
      materials: [material("Core drill + penetration + firestop materials", penetrationQty, "ea", 45)],
      milestone: "Penetrations complete",
    }),
    ...(() => {
      const trench = trenchingSpec(installationType, outdoorType, "cl2", null);
      if (!trench) return [];
      return [createLineItem({
        phase: "3) Pathway and Distribution Build",
        activity: "Trenching and earthwork",
        description: trench.description,
        quantity: pathwayFt,
        unit: "ft",
        laborUnits: trench.laborPerFt,
        laborRate: labor.laborer,
        laborRole: "Construction Laborer",
        materials: [material("Trenching materials and backfill", pathwayFt, "ft", trench.rate)],
        milestone: "Trench complete",
      })];
    })(),
    createLineItem({
      phase: "4) Power Equipment Install",
      activity: "DC hub deployment",
      description: `Install and mount ${dcHubQty} DC hub${dcHubQty > 1 ? "s" : ""} (1 per 10 pairs)`,
      quantity: dcHubQty,
      unit: "ea",
      laborUnits: 0.5,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("DC hub", dcHubQty, "ea", 1820)],
      milestone: "DC hubs set",
    }),
    createLineItem({
      phase: "4) Power Equipment Install",
      activity: "CL2 aggregator deployment",
      description: "Install and connect CL2 aggregator units",
      quantity: injectorQty,
      unit: "ea",
      laborUnits: 0.25,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("CL2 aggregators", injectorQty, "ea", 225)],
      milestone: "Aggregators set",
    }),
    createLineItem({
      phase: "5) Cable Installation and Termination",
      activity: "Class 2 cable pull",
      description: `Pull ${pairs} pair${pairs > 1 ? "s" : ""} (${totalConductors}× #${cl2AWG} AWG) in ${pullGroups} pull group${pullGroups > 1 ? "s" : ""}`,
      quantity: 1,
      unit: "lot",
      laborUnits: pullLaborHrs,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material(`#${cl2AWG} AWG Class 2 cable`, cablePairFt, "ft", cl2CableRate)],
      milestone: "Cable pull complete",
    }),
    createLineItem({
      phase: "5) Cable Installation and Termination",
      activity: "Termination and connector attachment",
      description: "Terminate ports, attach connectors, verify continuity",
      quantity: 1,
      unit: "lot",
      laborUnits: 1.5 + pairs * 0.3,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("Connectors and termination hardware", 1, "lot", 95)],
      milestone: "Terminations complete",
    }),
    createLineItem({
      phase: "5) Cable Installation and Termination",
      activity: "Cable management and labeling",
      description: "Dress cables, slack loops, apply labels per standard",
      quantity: 1,
      unit: "lot",
      laborUnits: 1 + pairs * 0.15,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("Labels and cable management", 1, "lot", 65)],
      milestone: "Labeling complete",
    }),
    createLineItem({
      phase: "6) Testing and Commissioning",
      activity: "Certification and load testing",
      description: "Continuity, load validation, and certification report",
      quantity: 1,
      unit: "lot",
      laborUnits: 2 + pairs * 0.15,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("Testing consumables", 1, "lot", 65)],
      milestone: "Testing complete",
    }),
    createLineItem({
      phase: "6) Testing and Commissioning",
      activity: "Functional performance verification",
      description: "End-to-end power delivery validation under load",
      quantity: 1,
      unit: "lot",
      laborUnits: 2,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [],
      milestone: "Functional test complete",
    }),
    createLineItem({
      phase: "6) Testing and Commissioning",
      activity: "Closeout and owner handoff",
      description: "As-built labels, test reports, owner training, and project handoff",
      quantity: 1,
      unit: "lot",
      laborUnits: 4,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "Project closed",
    }),
    createLineItem({
      phase: "6) Testing and Commissioning",
      activity: "Punchlist corrections",
      description: "Final walk and punchlist resolution",
      quantity: 1,
      unit: "lot",
      laborUnits: 4,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "Punchlist closed",
    }),
  ];

  const scenario = summarize("Class 2 DC", lineItems, {
    fit: powerW <= 100 && distanceFt <= 300 ? "good" : "warn",
    fitText:
      powerW <= 100 && distanceFt <= 300
        ? "Best for low-power and shorter spans"
        : "Parallel runs increase cost at higher loads",
  }, crewSize);

  const cl2ProvisionedW = pairs * effectiveWattsPerPair;
  scenario.capacity = {
    applicable: true,
    usedW: powerW,
    totalW: cl2ProvisionedW,
    remainingW: Math.max(0, cl2ProvisionedW - powerW),
    basis: `${pairs} deployed pair${pairs > 1 ? "s" : ""} to endpoint`,
    note: `${whole(effectiveWattsPerPair)}W delivered per pair after voltage-drop adjustment at ${whole(cl2Dist)} ft.`,
    totalLabel: "Pair Capacity",
  };

  return scenario;
}

function calculateClass4(powerW, distanceFt, labor, crewSize, installationType, outdoorType) {
  // FMP Class 4: 1 cable pair per channel (600W per channel at 360VDC)
  // 16AWG cable used for all CL4 runs

  const receiverQty = Math.max(1, Math.ceil(powerW / 1800));
  const channels = Math.max(1, Math.ceil(powerW / 600)); // each channel = 600W
  const cl4Pairs = channels; // 1 cable pair per channel
  const cl4TotalConductors = cl4Pairs * 2;
  const shelfQty = Math.max(1, Math.ceil(channels / 9)); // each shelf holds 9 transmitters

  // CL4 cabling: one physical cable bundle per receiver (each receiver accepts up to 3 channels/pairs)
  // CL4 cable pricing per foot (whole cable assembly): 1-pair=$1.10, 2-pair=$1.22, 3-pair=$1.36
  const cableRateFor = (pairsPerCable) =>
    pairsPerCable <= 1 ? 1.10 : pairsPerCable <= 2 ? 1.22 : 1.36;
  const cableRuns = receiverQty;
  const fullThreePairCables = Math.floor(channels / 3);
  const remainderPairs = channels - fullThreePairCables * 3; // 0, 1, or 2
  const cl4SingleRunFt = distanceFt * 1.1; // one bundle's run length with 10% slack
  const cl4CableFt = cableRuns * cl4SingleRunFt; // total cable feet across all bundles
  const cl4CableMaterialCost =
    fullThreePairCables * cableRateFor(3) * cl4SingleRunFt +
    (remainderPairs > 0 ? cableRateFor(remainderPairs) * cl4SingleRunFt : 0);
  const cl4CableRatePerFt = cl4CableFt > 0 ? cl4CableMaterialCost / cl4CableFt : cableRateFor(1);
  const cl4RunFt = distanceFt * 1.1; // pathway run length (single shared route)
  const pathwaySupportQty = Math.ceil(cl4RunFt / 8);
  const penetrationQty = Math.max(1, Math.ceil(distanceFt / 200));

  const lineItems = [
    createLineItem({
      phase: "1) Design and Engineering",
      activity: "Class 4 system design",
      description: "Safety review, power class mapping, channel allocation, and route design",
      quantity: 1,
      unit: "lot",
      laborUnits: 5 + distanceFt / 600,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "Class 4 design complete",
    }),
    createLineItem({
      phase: "1) Design and Engineering",
      activity: "Submittals and procurement",
      description: "Equipment submittals, head-end/receiver specs, procurement log",
      quantity: 1,
      unit: "lot",
      laborUnits: 4,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [],
      milestone: "Submittals approved",
    }),
    createLineItem({
      phase: "2) Permitting and Preconstruction",
      activity: "Pre-design survey",
      description: "Site verification, pathway confirmation, and access coordination",
      quantity: 1,
      unit: "lot",
      laborUnits: 2,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "Pre-design survey complete",
    }),
    createLineItem({
      phase: "2) Permitting and Preconstruction",
      activity: "AHJ package and plan/pathway review",
      description: "Code package prep, AHJ coordination, plan/pathway review, and installation sequencing",
      quantity: 1,
      unit: "lot",
      laborUnits: 3.5,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [material("Permit allowance", 1, "lot", 350)],
      milestone: "AHJ package issued",
    }),
    createLineItem({
      phase: "2) Permitting and Preconstruction",
      activity: "Mobilization and safety plan",
      description: "Safety plan, material staging, trade coordination",
      quantity: 1,
      unit: "lot",
      laborUnits: 6,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "Mobilization complete",
    }),
    createLineItem({
      phase: "3) Pathway and Distribution Build",
      activity: "CL4 pathway and support installation",
      description: "Install J-hooks, supports, and cable tray for CL4 and fiber routes",
      quantity: cl4RunFt,
      unit: "ft",
      laborUnits: 1 / 140,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("Pathway supports (J-hooks/tray)", pathwaySupportQty, "ea", 4.5)],
      milestone: "CL4 pathway complete",
    }),
    createLineItem({
      phase: "3) Pathway and Distribution Build",
      activity: "Core drilling, wall penetrations, and firestopping",
      description: "Core drill, wall penetrations, and UL firestop for CL4 pathway",
      quantity: penetrationQty,
      unit: "ea",
      laborUnits: 0.85,
      laborRate: labor.laborer,
      laborRole: "Construction Laborer",
      materials: [material("Core drill + penetration + firestop materials", penetrationQty, "ea", 45)],
      milestone: "Penetrations complete",
    }),
    ...(() => {
      const trench = trenchingSpec(installationType, outdoorType, "cl4", null);
      if (!trench) return [];
      return [createLineItem({
        phase: "3) Pathway and Distribution Build",
        activity: "Trenching and earthwork",
        description: trench.description,
        quantity: cl4RunFt,
        unit: "ft",
        laborUnits: trench.laborPerFt,
        laborRate: labor.laborer,
        laborRole: "Construction Laborer",
        materials: [material("Trenching materials and backfill", cl4RunFt, "ft", trench.rate)],
        milestone: "Trench complete",
      })];
    })(),
    createLineItem({
      phase: "4) Power Equipment Install",
      activity: "FMP transmitter shelf installation",
      description: `Install ${shelfQty} transmitter shelf${shelfQty > 1 ? "ves" : ""} (each holds up to 9 channels)`,
      quantity: shelfQty,
      unit: "ea",
      laborUnits: 1.5,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("Transmitter shelf", shelfQty, "ea", 1800)],
      milestone: "Shelves installed",
    }),
    createLineItem({
      phase: "4) Power Equipment Install",
      activity: "FMP transmitter channel cards",
      description: `Install ${channels} transmitter card${channels > 1 ? "s" : ""} (600W per channel)`,
      quantity: channels,
      unit: "ea",
      laborUnits: 0.25,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("Transmitter channel card", channels, "ea", 900)],
      milestone: "Channels installed",
    }),
    createLineItem({
      phase: "4) Power Equipment Install",
      activity: "FMP receiver hardware deployment",
      description: `Install ${receiverQty} receiver${receiverQty > 1 ? "s" : ""} (1800W max, up to 3 channels each)`,
      quantity: receiverQty,
      unit: "ea",
      laborUnits: 1.0,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("Class 4 receiver", receiverQty, "ea", 1950)],
      milestone: "Receivers installed",
    }),
    createLineItem({
      phase: "5) Cable Installation and Termination",
      activity: "CL4 copper cable installation",
      description: `Install ${cableRuns} cable bundle${cableRuns > 1 ? "s" : ""} (${cl4Pairs} pair${cl4Pairs > 1 ? "s" : ""} / ${cl4TotalConductors}× #16 AWG total) — one bundle per receiver, up to 3 pairs each`,
      quantity: cl4CableFt,
      unit: "ft",
      laborUnits: 1 / 110,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material(`#16 AWG CL4 cable (${cableRuns}× bundles)`, cl4CableFt, "ft", cl4CableRatePerFt)],
      milestone: "CL4 cable installed",
    }),
    createLineItem({
      phase: "5) Cable Installation and Termination",
      activity: "Termination and connector attachment",
      description: "Terminate CL4 conductors at both ends",
      quantity: 1,
      unit: "lot",
      laborUnits: 2 + channels * 0.3,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("CL4 termination kit", 1, "lot", 180)],
      milestone: "Terminations complete",
    }),
    createLineItem({
      phase: "5) Cable Installation and Termination",
      activity: "Cable management and labeling",
      description: "Dress cables, slack loops, apply labels per standard",
      quantity: 1,
      unit: "lot",
      laborUnits: 1.5,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("Labels and cable management", 1, "lot", 65)],
      milestone: "Labeling complete",
    }),
    createLineItem({
      phase: "6) Testing and Commissioning",
      activity: "CL4 power-up and fault validation",
      description: "Run turn-up checklist, verify fault detection per UL standard",
      quantity: 1,
      unit: "lot",
      laborUnits: 2 + channels * 0.8,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("Test equipment consumables", 1, "lot", 90)],
      milestone: "Fault validation complete",
    }),
    createLineItem({
      phase: "6) Testing and Commissioning",
      activity: "Functional performance verification",
      description: "End-to-end load test, power quality, and receiver output validation",
      quantity: 1,
      unit: "lot",
      laborUnits: 2 + channels * 0.4,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [],
      milestone: "Functional test complete",
    }),
    createLineItem({
      phase: "6) Testing and Commissioning",
      activity: "Closeout and owner handoff",
      description: "As-built drawings, test reports, owner training, and project handoff",
      quantity: 1,
      unit: "lot",
      laborUnits: 6,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "Project closed",
    }),
    createLineItem({
      phase: "6) Testing and Commissioning",
      activity: "Punchlist corrections",
      description: "Final walk, corrections, and sign-off",
      quantity: 1,
      unit: "lot",
      laborUnits: 4,
      laborRate: labor.design,
      laborRole: "Design/PM",
      materials: [],
      milestone: "Punchlist closed",
    }),
  ];

  const scenario = summarize("Class 4 Fault Managed Power", lineItems, {
    fit: powerW <= 4500 ? "good" : "warn",
    fitText:
      powerW <= 4500
        ? "Strong fit for medium-to-high power over long runs"
        : "Above 4.5 kW may require AC architecture",
  }, crewSize);

  const cl4ProvisionedW = receiverQty * 1800;
  scenario.capacity = {
    applicable: true,
    usedW: powerW,
    totalW: cl4ProvisionedW,
    remainingW: Math.max(0, cl4ProvisionedW - powerW),
    basis: `${receiverQty} receiver${receiverQty > 1 ? "s" : ""} provisioned (${receiverQty * 3} channel slots)`,
    note: `${channels} active channel${channels > 1 ? "s" : ""}; receiver-side headroom is shown here, and unused receiver slots would still need added transmitter cards to be activated.`,
    availableLabel: "Receiver Spare",
    totalLabel: "Receiver Capacity",
  };

  return scenario;
}

function summarize(name, lineItems, fitMeta, crewSize = 1) {
  let materialTotal = 0;
  let laborTotal = 0;
  let hoursTotal = 0;
  let designHours = 0;
  let installHours = 0;

  const rows = lineItems.map((x) => {
    const materialCost = x.materials.reduce((sum, m) => sum + m.qty * m.unitCost, 0);
    // Labor cost: total man-hours × rate ÷ crew size.
    // Design/PM phases are single-person work — crew size does not apply.
    const isDesignPhase = DESIGN_PHASES.has(x.phase);
    const laborCost = isDesignPhase
      ? x.laborHours * x.laborRate
      : (x.laborHours * x.laborRate) / crewSize;
    const lineTotal = materialCost + laborCost;
    materialTotal += materialCost;
    laborTotal += laborCost;
    hoursTotal += x.laborHours;
    if (DESIGN_PHASES.has(x.phase)) designHours += x.laborHours;
    else installHours += x.laborHours;

    return {
      ...x,
      materialCost,
      laborCost,
      lineTotal,
    };
  });

  const designDays = designHours / 8;
  const installDays = installHours / 8 / crewSize;

  return {
    name,
    rows,
    totalCost: materialTotal + laborTotal,
    totalHours: hoursTotal,
    totalDays: designDays + installDays,
    designDays,
    installDays,
    crewSize,
    fit: fitMeta.fit,
    fitText: fitMeta.fitText,
    materialTotal,
    laborTotal,
  };
}

function isScenarioApplicable(scenario) {
  return scenario.isApplicable !== false;
}

function scenarioWarningText(scenario) {
  return scenario.unavailabilityReason || scenario.fitText || "Not applicable";
}

function scenarioWarningShortText(scenario) {
  return scenario.unavailabilityShortText || "Not applicable";
}

function scenarioSortValue(scenario) {
  return isScenarioApplicable(scenario) ? scenario.totalCost : Number.POSITIVE_INFINITY;
}

function sortScenariosByCost(scenarios) {
  return [...scenarios].sort((a, b) => {
    const delta = scenarioSortValue(a) - scenarioSortValue(b);
    if (delta !== 0) return delta;
    return a.name.localeCompare(b.name);
  });
}

function formatScenarioCurrency(scenario, value = scenario.totalCost) {
  return isScenarioApplicable(scenario) ? money(value) : "N/A";
}

function formatScenarioNumber(scenario, value, digits = 1, suffix = "") {
  return isScenarioApplicable(scenario) ? `${num(value, digits)}${suffix}` : "N/A";
}

function getRoutingCostMultiplier(installationType, inBuildingType, outdoorType) {
  let multiplier = 1;

  // Installation type base multiplier
  if (installationType === "outdoor") {
    multiplier *= 1.35;
  } else if (installationType === "mixed") {
    multiplier *= 1.15;
  }

  // In-building routing adjustment (only when indoor or mixed)
  if (installationType === "indoor" || installationType === "mixed") {
    if (inBuildingType === "plenum") multiplier *= 1.2;
    else if (inBuildingType === "open-tray") multiplier *= 0.85;
    else if (inBuildingType === "j-hooks") multiplier *= 0.9;
    else if (inBuildingType === "surface") multiplier *= 0.8;
  }

  // Outdoor routing adjustment (only when outdoor or mixed)
  // Trenching costs are now separate line items; multiplier only accounts for outdoor exposure complexity
  if (installationType === "outdoor" || installationType === "mixed") {
    if (outdoorType === "direct-bury") multiplier *= 1.05;
    else if (outdoorType === "conduit-bury") multiplier *= 1.08;
    else if (outdoorType === "aerial") multiplier *= 0.95;
    else if (outdoorType === "wall-mount") multiplier *= 1.00; // baseline above-grade outdoor
    else if (outdoorType === "underground-duct") multiplier *= 1.1;
  }

  return multiplier;
}

// Routing multiplier is reduced for CL2/CL4 since they don't use AC conduit
function getArchRoutingMultiplier(archName, routingMult) {
  if (archName === "Class 1 AC") return routingMult;
  // CL2/CL4 get 50% of the routing adjustment (they still need pathway but not heavy conduit)
  return 1 + (routingMult - 1) * 0.5;
}

function getEndDeviceCostMultiplier(endDeviceType) {
  if (endDeviceType === "switch") return 1.1;
  if (endDeviceType === "media-converter") return 1.05;
  return 1.0; // direct to device
}

// Apply multipliers scoped to appropriate cost categories — mutates row.lineTotal so phase totals reconcile
function applyInputMultipliers(scenario, installationType, inBuildingType, outdoorType, endDeviceType) {
  const baseRoutingMult = getRoutingCostMultiplier(installationType, inBuildingType, outdoorType);
  const routingMult = getArchRoutingMultiplier(scenario.name, baseRoutingMult);
  const deviceMult = getEndDeviceCostMultiplier(endDeviceType);

  // Apply multipliers to individual rows so phase/cost-driver views reconcile with the scenario total
  let materialTotal = 0;
  let laborTotal = 0;
  scenario.rows.forEach((row) => {
    let mult = 1;
    if (row.phase.startsWith("3)") || row.phase.startsWith("5)")) mult = routingMult;
    else if (row.phase.startsWith("4)")) mult = deviceMult;
    if (mult !== 1) {
      row.materialCost *= mult;
      row.laborCost *= mult;
      row.lineTotal = row.materialCost + row.laborCost;
    }
    materialTotal += row.materialCost;
    laborTotal += row.laborCost;
  });
  scenario.materialTotal = materialTotal;
  scenario.laborTotal = laborTotal;
  return materialTotal + laborTotal;
}

function buildComparison(powerW, distanceFt, labor, crewSize, conduitCostOverride, installationType, inBuildingType, outdoorType, endDeviceType, outdoorConduitSize) {
  const scenarios = [
    calculateAC(powerW, distanceFt, labor, crewSize, conduitCostOverride, installationType, outdoorType, outdoorConduitSize),
    calculateClass2(powerW, distanceFt, labor, crewSize, installationType, outdoorType),
    calculateClass4(powerW, distanceFt, labor, crewSize, installationType, outdoorType),
  ];

  // Apply routing and endpoint multipliers to each scenario (scoped by phase)
  scenarios.forEach((scenario) => {
    if (!isScenarioApplicable(scenario)) return;
    scenario.totalCost = applyInputMultipliers(scenario, installationType, inBuildingType, outdoorType, endDeviceType);
  });

  return sortScenariosByCost(scenarios);
}

function renderSummary(scenarios, powerW, distanceFt, crewSize) {
  const applicableScenarios = sortScenariosByCost(scenarios).filter(isScenarioApplicable);
  const lowestCost = applicableScenarios.length ? applicableScenarios[0].totalCost : 0;
  const fastestDays = applicableScenarios.length ? Math.min(...applicableScenarios.map((s) => s.totalDays)) : 0;

  const warningHtml = scenarios
    .filter((scenario) => !isScenarioApplicable(scenario))
    .map((scenario) => `
      <div class="summary-warning" data-arch="${scenarioArchKey(scenario.name)}">
        <strong>${scenarioShortLabel(scenario.name)} warning:</strong> ${scenarioWarningText(scenario)}
      </div>
    `)
    .join("");

  const scenarioCards = scenarios.map((s) => {
    const applicable = isScenarioApplicable(s);
    const isCheapest = applicable && s.totalCost === lowestCost;
    const isFastest = applicable && s.totalDays === fastestDays;
    const isSafest = scenarioArchKey(s.name) === "cl4";
    const cheapestClass = isCheapest ? " cheapest" : "";
    const badges = [
      isCheapest ? `<span class="snap-badge good">Lowest Cost</span>` : "",
      isFastest  ? `<span class="snap-badge fast">Fastest</span>`     : "",
      isSafest   ? `<span class="snap-badge safe">Safest</span>`      : "",
    ].join("");

    return `
      <article class="metric scenario-metric${cheapestClass}" data-arch="${scenarioArchKey(s.name)}">
        <p class="scenario-metric-name">${s.name}</p>
        <h3>${formatScenarioCurrency(s)}</h3>
        <p>${applicable ? `${num(s.totalDays, 1)} calendar days` : "Not applicable"}</p>
        ${applicable ? "" : `<p class="subtle">${scenarioWarningText(s)}</p>`}
        ${badges ? `<div class="snap-badges">${badges}</div>` : ""}
      </article>
    `;
  }).join("");

  document.getElementById("summary").innerHTML = `
    <h2>Project Snapshot</h2>
    <div class="metrics snapshot-context">
      <article class="metric">
        <p>Power / Distance</p>
        <h3>${num(powerW, 0)} W &nbsp;·&nbsp; ${num(distanceFt, 0)} ft</h3>
      </article>
      <article class="metric">
        <p>Install Crew Size</p>
        <h3>${crewSize} persons</h3>
        <p>phases 3 – 6</p>
      </article>
    </div>
    ${warningHtml ? `<div class="summary-warnings">${warningHtml}</div>` : ""}
    <div class="metrics snapshot-scenarios">
      ${scenarioCards}
    </div>
  `;
}

function scenarioShortLabel(name) {
  if (name.includes("Class 1") || name.includes("CL1")) return "CL1 AC";
  if (name.includes("Class 2") || name.includes("CL2")) return "CL2 DC";
  if (name.includes("Class 4") || name.includes("CL4")) return "CL4 FMP";
  return name.slice(0, 6);
}

function scenarioArchKey(name) {
  if (name.includes("Class 1") || name.includes("CL1")) return "ac";
  if (name.includes("Class 2") || name.includes("CL2")) return "cl2";
  if (name.includes("Class 4") || name.includes("CL4")) return "cl4";
  return "";
}

function buildPhaseSectionsHtml(scenarios) {
  const phaseOrder = [...new Set(scenarios.flatMap((s) => s.rows.map((r) => r.phase)))];
  if (!phaseOrder.length) {
    return '<p class="subtle">No phase line items are available for this selection.</p>';
  }

  const labels = scenarios.map((s) => scenarioShortLabel(s.name));

  const html = phaseOrder
    .map((phase) => {
      const cards = scenarios
        .map((scenario) => {
          const applicable = isScenarioApplicable(scenario);
          const phaseRows = scenario.rows.filter((r) => r.phase === phase);
          const phaseCost = phaseRows.reduce((sum, r) => sum + r.lineTotal, 0);
          const rawHours = phaseRows.reduce((sum, r) => sum + r.laborHours, 0);
          const phaseDays = DESIGN_PHASES.has(phase)
            ? rawHours / 8
            : rawHours / 8 / scenario.crewSize;

          return `
            <article class="option-pill" data-arch="${scenarioArchKey(scenario.name)}">
              <h4>${scenario.name}</h4>
              <p><strong>Phase Cost:</strong> ${applicable ? money(phaseCost) : "N/A"}</p>
              <p><strong>Phase Time:</strong> ${applicable ? `${num(phaseDays, 1)} days` : "N/A"}</p>
              ${applicable ? "" : `<p class="subtle">${scenarioWarningText(scenario)}</p>`}
            </article>
          `;
        })
        .join("");

      const headerCells = labels.map((l) => `<th>${l}</th>`).join("");

      // Collect all unique activities across scenarios for this phase
      const allActivities = [];
      const seen = new Set();
      scenarios.forEach((s) => {
        s.rows.filter((r) => r.phase === phase).forEach((r) => {
          if (!seen.has(r.activity)) {
            seen.add(r.activity);
            allActivities.push(r.activity);
          }
        });
      });

      // Build cost lookup per scenario
      const costByScenario = scenarios.map((s) => {
        const map = {};
        s.rows.filter((r) => r.phase === phase).forEach((r) => {
          map[r.activity] = (map[r.activity] || 0) + r.lineTotal;
        });
        return map;
      });

      // Build rows from actual line items
      const colTotals = scenarios.map(() => 0);
      const checkRows = allActivities.map((activity) => {
        const cells = scenarios.map((s, si) => {
          const cost = costByScenario[si][activity] || 0;
          colTotals[si] += cost;
          if (cost > 0) {
            return `<td class="task-check task-cost">${money(cost)}</td>`;
          }
          return `<td class="task-check"><span class="check-no">&mdash;</span></td>`;
        }).join("");
        return `<tr><td class="task-name">${activity}</td>${cells}</tr>`;
      }).join("");

      // Totals row
      const totalCells = scenarios.map((scenario, index) => (
        isScenarioApplicable(scenario)
          ? `<td class="task-check task-cost task-total">${money(colTotals[index])}</td>`
          : `<td class="task-check task-total"><span class="check-no">N/A</span></td>`
      )).join("");
      const totalsRow = `<tr class="task-totals-row"><td class="task-name"><strong>Phase Total</strong></td>${totalCells}</tr>`;

      return `
        <article class="phase-card">
          <h3>${phase}</h3>
          <div class="phase-options">${cards}</div>
          <div class="task-checklist">
            <table class="task-table">
              <thead><tr><th>Line Item</th>${headerCells}</tr></thead>
              <tbody>${checkRows}${totalsRow}</tbody>
            </table>
          </div>
        </article>
      `;
    })
    .join("");

  return `<div class="phase-grid">${html}</div>`;
}

function renderPhaseSections(scenarios) {
  document.getElementById("phaseBreakdown").innerHTML = buildPhaseSectionsHtml(scenarios);
}

const GANTT_COLORS = ["gantt-bar-0","gantt-bar-1","gantt-bar-2","gantt-bar-3","gantt-bar-4","gantt-bar-5"];
const PHASE_NAMES_SHORT = {
  "1) Design and Engineering": "Design",
  "2) Permitting and Preconstruction": "Permitting",
  "3) Pathway and Distribution Build": "Pathway",
  "4) Power Equipment Install": "Equipment",
  "5) Cable Installation and Termination": "Cabling",
  "6) Testing and Commissioning": "Commissioning",
};

function renderGantt(scenarios) {
  const phaseOrder = [...new Set(scenarios.flatMap((s) => s.rows.map((r) => r.phase)))];
  const applicableScenarios = scenarios.filter(isScenarioApplicable);
  const maxDays = applicableScenarios.length ? Math.max(...applicableScenarios.map((s) => s.totalDays)) : 1;

  const bars = scenarios.map((scenario) => {
    const applicable = isScenarioApplicable(scenario);
    const trackBars = phaseOrder.map((phase, pi) => {
      const phaseRows = scenario.rows.filter((r) => r.phase === phase);
      const rawHours = phaseRows.reduce((sum, r) => sum + r.laborHours, 0);
      const days = DESIGN_PHASES.has(phase)
        ? rawHours / 8
        : rawHours / 8 / scenario.crewSize;
      const pct = maxDays > 0 ? (days / maxDays) * 100 : 0;
      const short = PHASE_NAMES_SHORT[phase] || phase;
      const colorClass = GANTT_COLORS[pi % GANTT_COLORS.length];
      return { phase, short, days, pct, colorClass };
    }).filter((b) => applicable && b.days > 0);

    return { scenario, bars: trackBars };
  });

  const legendItems = phaseOrder.map((phase, pi) => {
    const colorClass = GANTT_COLORS[pi % GANTT_COLORS.length];
    const short = PHASE_NAMES_SHORT[phase] || phase;
    return `<span class="gantt-legend-item">
      <span class="gantt-legend-swatch ${colorClass}"></span>${short}
    </span>`;
  }).join("");

  const trackHtml = bars.map(({ scenario, bars: trackBars }) => {
    const barHtml = trackBars.map((b) => `
      <div class="gantt-bar ${b.colorClass}" style="width:${b.pct}%" title="${b.phase}: ${num(b.days,1)} days">
        ${b.pct > 8 ? b.short : ""}
        <span class="gantt-tooltip">${b.phase}<br/>${num(b.days,1)} days</span>
      </div>
    `).join("");

    return `
      <div class="gantt-scenario">
        <div class="gantt-label-row">
          <span class="gantt-scenario-name">${scenario.name}</span>
          <span class="gantt-total-label">${isScenarioApplicable(scenario) ? `${num(scenario.totalDays,1)} total days` : "N/A"}</span>
          <span class="badge ${scenario.fit}">${scenario.fitText}</span>
        </div>
        <div class="gantt-track">${barHtml}</div>
      </div>
    `;
  }).join("");

  document.getElementById("ganttChart").innerHTML = `
    <div class="gantt-wrap">
      ${trackHtml}
    </div>
    <div class="gantt-legend">${legendItems}</div>
  `;
}

function getLaborRates() {
  const electrician = clamp(Number(document.getElementById("rateElectrician").value) || defaultLabor.electrician, 10, 250);
  const lvTech = clamp(Number(document.getElementById("rateLvTech").value) || defaultLabor.lvTech, 10, 250);
  const design = clamp(Number(document.getElementById("rateDesign").value) || defaultLabor.design, 10, 250);
  const designer = clamp(Number(document.getElementById("rateDesigner").value) || defaultLabor.designer, 10, 250);
  const laborer = clamp(Number(document.getElementById("rateLaborer").value) || defaultLabor.laborer, 10, 250);

  return { electrician, lvTech, design, designer, laborer };
}

function resetLaborRates() {
  document.getElementById("rateElectrician").value = defaultLabor.electrician;
  document.getElementById("rateLvTech").value = defaultLabor.lvTech;
  document.getElementById("rateDesign").value = defaultLabor.design;
  document.getElementById("rateDesigner").value = defaultLabor.designer;
  document.getElementById("rateLaborer").value = defaultLabor.laborer;
}

let hasGenerated = false;
let projectLocked = false;
let lastGeneratedMode = null;

function getInputs() {
  const powerW = clamp(Number(document.getElementById("powerW").value) || 0, 10, 15000);
  const distanceFt = clamp(Number(document.getElementById("distanceFt").value) || 0, 25, 5000);
  const crewSize = clamp(Number(document.getElementById("crewSize").value) || 1, 1, 20);
  const conduitCostOverride = clamp(Number(document.getElementById("conduitCostPerFt").value) || 0, 0, 50);
  const installationType = document.getElementById("installationType").value;
  const inBuildingType = document.getElementById("inBuildingType").value;
  const outdoorType = document.getElementById("outdoorType").value;
  const outdoorConduitSize = document.getElementById("outdoorConduitSize").value;
  const endDeviceType = document.getElementById("endDeviceType").value;

  return { powerW, distanceFt, crewSize, conduitCostOverride, installationType, inBuildingType, outdoorType, outdoorConduitSize, endDeviceType };
}

// Normalize a numeric input on blur/change — only after user stops typing
function normalizeNumericInput(id, min, max, fallback) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("change", () => {
    const v = clamp(Number(el.value) || fallback, min, max);
    el.value = v;
  });
}

function revealOutputs() {
  const outputArea = document.getElementById("outputArea");
  outputArea.classList.remove("output-hidden");
  showExportPackage();
  renderSectionNav();
}

const SECTION_NAV_SELECTOR = ".nav-target[data-nav-label]";
const SECTION_NAV_GROUPS = {
  single: {
    setup: ["singleLocationSection", "laborRates"],
    results: ["summary", "phaseSections", "timelineSection", "pricingComparison", "costDriversSection", "capacitySection", "assumptionsSection"],
  },
  multi: {
    setup: ["multiLocationSection", "laborRates"],
    results: ["multiSummary", "multiLocationBreakdown", "multiGrandTotals"],
  },
};

function setGenerateButtonLabel() {
  const button = document.getElementById("calculateProjectBtn");
  if (!button) return;

  button.textContent = currentMode === "multi"
    ? "Generate Multi-Location Comparison"
    : "Generate Comparison";
}

function updateExportActions() {
  const exportPackage = document.getElementById("exportPackage");
  if (!exportPackage) return;

  const helperText = exportPackage.querySelector(".section-head p");
  const pdfBtn = document.getElementById("exportPdfBtn");
  const excelBtn = document.getElementById("exportExcelBtn");
  const isMulti = lastGeneratedMode === "multi";

  if (helperText) {
    helperText.textContent = isMulti
      ? "Download a formatted multi-location project report for customer delivery."
      : "Download a formatted report for customer delivery.";
  }

  if (pdfBtn) {
    pdfBtn.textContent = isMulti ? "Export Project PDF" : "Export PDF";
  }

  if (excelBtn) {
    excelBtn.hidden = isMulti;
    excelBtn.disabled = isMulti;
  }
}

function showExportPackage() {
  const exportPackage = document.getElementById("exportPackage");
  if (!exportPackage) return;

  updateExportActions();
  exportPackage.hidden = false;
}

function hideExportPackage() {
  const exportPackage = document.getElementById("exportPackage");
  if (!exportPackage) return;

  exportPackage.hidden = true;
}

function setProjectLocked(locked) {
  projectLocked = locked;
  document.body.classList.toggle("project-locked", locked);

  const toolbar = document.getElementById("projectToolbar");
  if (toolbar) {
    toolbar.hidden = !locked;
  }

  ["analysisMode", "singleLocationSection", "multiLocationSection", "laborRates"].forEach((sectionId) => {
    const section = document.getElementById(sectionId);
    if (!section) return;

    section.querySelectorAll("input, select, button").forEach((control) => {
      control.disabled = locked;
    });
  });
}

function clearOutputContent() {
  [
    "summary",
    "phaseBreakdown",
    "ganttChart",
    "comparisonRadar",
    "costDriversTable",
    "capacityAvailability",
    "multiSummary",
    "multiLocationBreakdown",
    "multiGrandTotals",
  ].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.innerHTML = "";
  });
}

function resetLocationCards() {
  locations = [];
  locationIdCounter = 0;
  const locationList = document.getElementById("locationList");
  if (locationList) locationList.innerHTML = "";
  addLocation();
  addLocation();
}

function clearProject() {
  hasGenerated = false;
  lastGeneratedMode = null;
  lastScenarios = null;
  lastInputs = null;
  lastMultiReport = null;

  document.getElementById("powerW").value = 1000;
  document.getElementById("distanceFt").value = 500;
  document.getElementById("crewSize").value = 3;
  document.getElementById("conduitCostPerFt").value = 0;
  document.getElementById("installationType").value = "indoor";
  document.getElementById("inBuildingType").value = "idf";
  document.getElementById("outdoorType").value = "direct-bury";
  document.getElementById("outdoorConduitSize").value = '2"';
  document.getElementById("endDeviceType").value = "switch";
  document.getElementById("multiCrewSize").value = 3;
  document.getElementById("projectName").value = "";
  document.getElementById("customerName").value = "";
  document.getElementById("preparedBy").value = "";

  resetLaborRates();
  resetLocationCards();
  clearOutputContent();
  hideExportPackage();
  document.getElementById("outputArea").classList.add("output-hidden");
  document.getElementById("multiOutputArea").classList.add("output-hidden");
  setMode("single");
  handleInstallationTypeChange();
  setProjectLocked(false);
  updateExportActions();
  renderSectionNav();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getSectionNavIds() {
  const outputVisible = !document.getElementById("outputArea").classList.contains("output-hidden");
  const multiOutputVisible = !document.getElementById("multiOutputArea").classList.contains("output-hidden");

  if (currentMode === "multi") {
    return multiOutputVisible ? SECTION_NAV_GROUPS.multi.results : SECTION_NAV_GROUPS.multi.setup;
  }

  return outputVisible ? SECTION_NAV_GROUPS.single.results : SECTION_NAV_GROUPS.single.setup;
}

function getVisibleNavSections() {
  return getSectionNavIds()
    .map((id) => document.getElementById(id))
    .filter((section) => section && section.matches(SECTION_NAV_SELECTOR))
    .filter((section) => {
    if (!section.id) return false;
    if (section.closest(".output-hidden")) return false;

    const style = window.getComputedStyle(section);
    if (style.display === "none" || style.visibility === "hidden") return false;

    return section.getClientRects().length > 0;
  });
}

function setActiveSectionNav(activeId) {
  document.querySelectorAll(".section-nav-link").forEach((link) => {
    const isActive = link.dataset.target === activeId;
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
}

function updateActiveSectionNav() {
  const sections = getVisibleNavSections();
  if (!sections.length) {
    setActiveSectionNav("");
    return;
  }

  const threshold = Math.max(96, window.innerHeight * 0.22);
  let activeId = sections[0].id;
  sections.forEach((section) => {
    if (section.getBoundingClientRect().top <= threshold) {
      activeId = section.id;
    }
  });

  setActiveSectionNav(activeId);
}

function renderSectionNav() {
  const nav = document.getElementById("sectionNav");
  const list = document.getElementById("sectionNavList");
  if (!nav || !list) return;

  const sections = getVisibleNavSections();
  nav.classList.toggle("is-empty", sections.length === 0);
  list.innerHTML = sections.map((section) => `
    <a class="section-nav-link" href="#${section.id}" data-target="${section.id}">${section.dataset.navLabel}</a>
  `).join("");

  updateActiveSectionNav();
}

function renderSpiderChart(scenarios) {
  const container = document.getElementById("comparisonRadar");
  if (!container) return;

  const applicableScenarios = sortScenariosByCost(scenarios).filter(isScenarioApplicable);
  const ceiling = applicableScenarios.length ? Math.max(...applicableScenarios.map((s) => s.totalCost)) * 1.5 : 1;
  const lowestCost = applicableScenarios.length ? applicableScenarios[0].totalCost : 0;
  const sorted = sortScenariosByCost(scenarios);

  const rows = sorted.map((scenario) => {
    const applicable = isScenarioApplicable(scenario);
    const arch = scenarioArchKey(scenario.name);
    const archLabel = arch === "ac" ? "AC" : arch === "cl2" ? "CL2" : "CL4";
    const pct = applicable && ceiling > 0 ? (scenario.totalCost / ceiling) * 100 : 0;
    const cheapestBadge = applicable && scenario.totalCost === lowestCost ? `<span class="cost-best">Lowest</span>` : "";
    return `
      <article class="cost-row" data-arch="${arch}">
        <div class="cost-row-head">
          <p class="cost-row-name">${archLabel} ${cheapestBadge}</p>
          <p class="cost-row-value">${formatScenarioCurrency(scenario)}</p>
        </div>
        <div class="cost-row-track">
          <div class="cost-row-fill" style="width:${pct}%"></div>
        </div>
      </article>
    `;
  }).join("");

  container.innerHTML = `
    <div class="cost-chart" role="img" aria-label="Cost comparison bars for AC, CL2, and CL4">
      <div class="cost-scale">Scale ceiling: ${money(ceiling)}</div>
      ${rows}
    </div>
  `;
}


function renderCostDrivers(scenarios) {
  const container = document.getElementById("costDriversTable");
  if (!container) return;

  // Collect all line items and merge costs from each architecture
  const driverMap = new Map();

  scenarios.forEach((scenario) => {
    const archLabel = scenarioArchKey(scenario.name) === "ac" ? "AC"
      : scenarioArchKey(scenario.name) === "cl2" ? "CL2" : "CL4";
    scenario.rows.forEach((row) => {
      const key = row.activity;
      if (!driverMap.has(key)) {
        driverMap.set(key, { activity: row.activity, phase: row.phase, description: row.description || "", costs: {} });
      }
      driverMap.get(key).costs[archLabel] = (driverMap.get(key).costs[archLabel] || 0) + row.lineTotal;
    });
  });

  // Find top 5 by max cost across any architecture
  const drivers = [...driverMap.values()]
    .map((d) => ({ ...d, maxCost: Math.max(...Object.values(d.costs)) }))
    .sort((a, b) => b.maxCost - a.maxCost)
    .slice(0, 5);

  // Generate a reason why this item drives cost
  function costReason(d) {
    const archs = Object.entries(d.costs).sort((a, b) => b[1] - a[1]);
    const topArch = archs[0][0];
    const phase = d.phase.replace(/^\d+\)\s*/, "");
    if (d.activity.toLowerCase().includes("conduit")) return `Long conduit runs scale linearly with distance — material + labor compound on ${topArch} installations.`;
    if (d.activity.toLowerCase().includes("trench")) return `Earthwork is distance-intensive — depth and width requirements add heavy labor and equipment cost.`;
    if (d.activity.toLowerCase().includes("cable pull") || d.activity.toLowerCase().includes("cable install")) return `Cable material × conductor count × distance drives this line — higher pair counts at long distances compound quickly.`;
    if (d.activity.toLowerCase().includes("head-end") || d.activity.toLowerCase().includes("transmitter")) return `CL4 head-end hardware carries a high per-channel cost that scales with power demand.`;
    if (d.activity.toLowerCase().includes("transformer") || d.activity.toLowerCase().includes("panel")) return `Heavy electrical equipment (transformer, panelboard) required for high-power AC builds.`;
    if (d.activity.toLowerCase().includes("design") || d.activity.toLowerCase().includes("engineering")) return `Design complexity scales with distance and power — longer runs require more coordination and documentation.`;
    if (d.activity.toLowerCase().includes("permit") || d.activity.toLowerCase().includes("ahj")) return `AHJ review and permitting carry fixed minimum effort plus wait-time schedule impact.`;
    if (d.activity.toLowerCase().includes("hub") || d.activity.toLowerCase().includes("aggregator")) return `Equipment hardware scales with power demand — more pairs/channels require more aggregation points.`;
    if (d.activity.toLowerCase().includes("receiver")) return `Receiver hardware scales with endpoint count — each output location requires dedicated hardware.`;
    return `Significant ${phase.toLowerCase()} cost driven by the combination of quantity, distance, and labor intensity.`;
  }

  const tableRows = drivers.map((d, i) => {
    const archs = Object.keys(d.costs).filter((a) => d.costs[a] > 0).join(", ");
    const reason = costReason(d);
    return `
      <tr class="cost-driver-row" data-rank="${i + 1}">
        <td class="cost-driver-rank">${i + 1}</td>
        <td class="cost-driver-activity">
          <span class="cost-driver-name">${d.activity}</span>
        </td>
        <td class="cost-driver-arch">${archs}</td>
        <td class="cost-driver-reason">${reason}</td>
      </tr>
    `;
  }).join("");

  container.innerHTML = `
    <table class="cost-drivers-table">
      <thead>
        <tr>
          <th class="col-rank">#</th>
          <th class="col-activity">Line Item</th>
          <th class="col-arch">Power Class</th>
          <th class="col-reason">Why It Drives Cost</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

function renderCapacityAvailability(scenarios) {
  const container = document.getElementById("capacityAvailability");
  if (!container) return;

  const order = ["ac", "cl2", "cl4"];

  const cards = order.map((arch) => {
    const scenario = scenarios.find((item) => scenarioArchKey(item.name) === arch);
    if (!scenario || !scenario.capacity) return "";

    const capacity = scenario.capacity;
    const chartTotalW = Math.max(capacity.totalW || capacity.usedW || 0, 1);
    const usedW = clamp(capacity.usedW || 0, 0, chartTotalW);
    const remainingW = Math.max(0, capacity.remainingW ?? (chartTotalW - usedW));
    const usedPct = capacity.applicable === false ? 100 : clamp((usedW / chartTotalW) * 100, 0, 100);
    const remainingPct = capacity.applicable === false ? 0 : Math.max(0, 100 - usedPct);
    const remainingPctLabel = remainingPct > 0 && remainingPct < 1 ? "<1%" : `${whole(remainingPct)}%`;
    const pieStyle = capacity.applicable === false
      ? "--used-pct: 100; --pie-color: rgba(95, 102, 116, 0.22);"
      : `--used-pct: ${usedPct}; --pie-color: var(--arch-${arch});`;
    const stats = capacity.stats || [
      { label: capacity.usedLabel || "In Use", value: `${whole(usedW)} W` },
      { label: capacity.availableLabel || "Available", value: `${whole(remainingW)} W` },
      { label: capacity.totalLabel || "Provisioned", value: `${whole(capacity.totalW)} W` },
    ];
    const ariaLabel = capacity.ariaLabel || `${scenarioShortLabel(scenario.name)} uses ${whole(usedW)} watts out of ${whole(capacity.totalW)} watts of ${capacity.totalLabel || "provisioned"}, leaving ${whole(remainingW)} watts available.`;

    return `
      <article class="capacity-card${capacity.applicable === false ? " is-unavailable" : ""}" data-arch="${arch}">
        <div class="capacity-card-head">
          <p class="capacity-card-kicker">Future Capacity</p>
          <h3>${scenarioShortLabel(scenario.name)}</h3>
          <p class="capacity-card-basis">${capacity.basis}</p>
        </div>
        <div class="capacity-body">
          <div class="capacity-pie" style="${pieStyle}" role="img" aria-label="${ariaLabel}">
            <div class="capacity-pie-center">
              <strong>${capacity.applicable === false ? "N/A" : remainingPctLabel}</strong>
              <span>${capacity.applicable === false ? "limit" : "free"}</span>
            </div>
          </div>
          <div class="capacity-stats">
            ${stats.map((stat) => `
              <div class="capacity-stat">
                <span>${stat.label}</span>
                <strong>${stat.value}</strong>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="capacity-legend">
          <span class="capacity-legend-item"><span class="capacity-swatch" style="--swatch:${capacity.applicable === false ? "rgba(95, 102, 116, 0.22)" : `var(--arch-${arch})`}\;"></span>Used</span>
          <span class="capacity-legend-item"><span class="capacity-swatch capacity-swatch-free"></span>Available</span>
        </div>
        <p class="capacity-note">${capacity.note}</p>
      </article>
    `;
  }).join("");

  container.innerHTML = `<div class="capacity-grid">${cards}</div>`;
}

function buildCapacityBarChartHtml(scenarios) {
  const order = ["ac", "cl2", "cl4"];

  const rows = order.map((arch) => {
    const scenario = scenarios.find((item) => scenarioArchKey(item.name) === arch);
    if (!scenario || !scenario.capacity) return "";

    const capacity = scenario.capacity;
    const chartTotalW = Math.max(capacity.totalW || capacity.usedW || 0, 1);
    const usedW = clamp(capacity.usedW || 0, 0, chartTotalW);
    const remainingW = Math.max(0, capacity.remainingW ?? (chartTotalW - usedW));
    const usedPct = capacity.applicable === false ? 100 : clamp((usedW / chartTotalW) * 100, 0, 100);
    const archLabel = scenarioShortLabel(scenario.name);
    const secondary = capacity.applicable === false
      ? scenarioWarningShortText(scenario)
      : `${whole(remainingW)} W available of ${whole(chartTotalW)} W ${capacity.totalLabel || "provisioned"}`;

    return `
      <div class="capacity-bar-row${capacity.applicable === false ? " is-unavailable" : ""}" data-arch="${arch}">
        <div class="capacity-bar-head">
          <span class="capacity-bar-name">${archLabel}</span>
          <span class="capacity-bar-value">${capacity.applicable === false ? "N/A" : `${whole(usedPct)}% used`}</span>
        </div>
        <div class="capacity-bar-track" role="img" aria-label="${capacity.ariaLabel || `${archLabel} uses ${whole(usedW)} watts out of ${whole(chartTotalW)} watts.`}">
          <span class="capacity-bar-used" style="width:${usedPct}%"></span>
        </div>
        <p class="capacity-bar-meta">${secondary}</p>
      </div>
    `;
  }).join("");

  return `<div class="capacity-bar-chart">${rows}</div>`;
}


function runModel() {
  const labor = getLaborRates();
  const { powerW, distanceFt, crewSize, conduitCostOverride, installationType, inBuildingType, outdoorType, outdoorConduitSize, endDeviceType } = getInputs();

  const scenarios = buildComparison(powerW, distanceFt, labor, crewSize, conduitCostOverride, installationType, inBuildingType, outdoorType, endDeviceType, outdoorConduitSize);
  captureExportData(scenarios, { powerW, distanceFt, crewSize, conduitCostOverride, installationType, inBuildingType, outdoorType, outdoorConduitSize, endDeviceType });
  renderPhaseSections(scenarios);
  renderGantt(scenarios);
  renderSummary(scenarios, powerW, distanceFt, crewSize);
  renderSpiderChart(scenarios);
  renderCostDrivers(scenarios);
  renderCapacityAvailability(scenarios);
  renderSectionNav();
}

function generateOutput() {
  hasGenerated = true;
  revealOutputs();
  runModel();
  setProjectLocked(true);
  document.getElementById("exportPackage").scrollIntoView({ behavior: "smooth", block: "start" });
}

function maybeRunModel() {
  if (hasGenerated) {
    runModel();
  }
}

function handleInstallationTypeChange() {
  const installationType = document.getElementById("installationType").value;
  const indoorGroup = document.getElementById("indoorRoutingGroup");
  const outdoorGroup = document.getElementById("outdoorRoutingGroup");

  if (installationType === "indoor") {
    indoorGroup.style.display = "grid";
    outdoorGroup.style.display = "none";
  } else if (installationType === "outdoor") {
    indoorGroup.style.display = "none";
    outdoorGroup.style.display = "grid";
  } else if (installationType === "mixed") {
    indoorGroup.style.display = "grid";
    outdoorGroup.style.display = "grid";
  }
}

// ─── Export Functions ──────────────────────────────────────────────────────────
let lastScenarios = null;
let lastInputs = null;
let lastMultiReport = null;

function captureExportData(scenarios, inputs) {
  lastScenarios = scenarios;
  lastInputs = inputs;
  lastMultiReport = null;
  lastGeneratedMode = "single";
  updateExportActions();
}

function captureMultiExportData(perLocation, archTotals, crewSize, aggregateScenarios) {
  lastScenarios = null;
  lastInputs = null;
  lastGeneratedMode = "multi";
  lastMultiReport = {
    perLocation,
    archTotals,
    crewSize,
    aggregateScenarios,
  };
  updateExportActions();
}

function getExportMeta() {
  return {
    projectName: document.getElementById("projectName").value || "Power Delivery Comparison",
    customerName: document.getElementById("customerName").value || "",
    preparedBy: document.getElementById("preparedBy").value || "",
    date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  };
}

function getAssumptions() {
  return [
    "Unit rates based on Panduit planning sheets, normalized for single-site comparison.",
    "Labor day = 8 hours. Design phases are not crew-parallelized.",
    "Distance influences both material quantity and installation effort.",
    "Class 2 uses 100W per pair with AWG sized by distance (#18 ≤300ft, #16 ≤550ft, #14 ≤900ft, #12 to 1750ft); above 1750ft Class 2 is not applicable.",
    "Class 4 uses #16 AWG copper with pair count derived from voltage drop at 450VDC; cable is priced as a multi-pair assembly.",
    "Trenching is calculated as a separate line item (depth and conduit-size driven) when installation type is outdoor or mixed and outdoor routing is direct-bury, conduit-buried, or underground duct.",
    "Routing multipliers applied to pathway (Phase 3) and cable (Phase 5) only.",
    "End device multiplier applied to equipment phase (Phase 4) only.",
    "Crew size applies to Phases 3–6 (install phases) only.",
    "One design revision cycle included. Additional revisions priced separately.",
    "Permitting fees are allowance-based and vary by jurisdiction.",
  ];
}

const PDF_MARGIN = 12;
const PDF_HEADER_COLOR = [15, 118, 110];
const PDF_GRID_COLOR = [226, 232, 240];

function createPdfDocument() {
  const { jsPDF } = window.jspdf;
  return new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
}

function pdfBaseTableOptions() {
  return {
    theme: "grid",
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: PDF_GRID_COLOR,
      lineWidth: 0.1,
      valign: "top",
    },
    headStyles: {
      fillColor: PDF_HEADER_COLOR,
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  };
}

function pdfNextPage(doc) {
  doc.addPage();
  return PDF_MARGIN;
}

function pdfAddSectionTitle(doc, title, y) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y > pageHeight - 24) {
    y = pdfNextPage(doc);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(31, 41, 55);
  doc.text(title, PDF_MARGIN, y);
  return y + 6;
}

function pdfAddTable(doc, title, head, body, y, options = {}) {
  const titleY = pdfAddSectionTitle(doc, title, y);
  doc.autoTable({
    ...pdfBaseTableOptions(),
    startY: titleY,
    head: [head],
    body,
    ...options,
  });
  return doc.lastAutoTable.finalY + 6;
}

function pdfAddCoverPage(doc, meta, subtitle, summaryRows = []) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFillColor(...PDF_HEADER_COLOR);
  doc.rect(0, 0, pageWidth, 26, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(31, 41, 55);
  doc.text(meta.projectName, pageWidth / 2, 44, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(95, 102, 116);
  doc.text(subtitle, pageWidth / 2, 52, { align: "center" });

  let y = 68;
  const coverDetails = [
    meta.customerName ? `Customer: ${meta.customerName}` : null,
    meta.preparedBy ? `Prepared By: ${meta.preparedBy}` : null,
    `Date: ${meta.date}`,
    "Tool: Power Delivery Comparison Tool",
  ].filter(Boolean);

  doc.setFontSize(10.5);
  coverDetails.forEach((line) => {
    doc.text(line, pageWidth / 2, y, { align: "center" });
    y += 6;
  });

  if (summaryRows.length) {
    doc.autoTable({
      ...pdfBaseTableOptions(),
      startY: y + 6,
      head: [["Project Snapshot", "Value"]],
      body: summaryRows,
      tableWidth: 150,
      margin: { left: (pageWidth - 150) / 2, right: (pageWidth - 150) / 2 },
    });
  }

  doc.setFontSize(10);
  doc.setTextColor(95, 102, 116);
  doc.text("Customer-ready comparison report generated from the current project inputs.", pageWidth / 2, pageHeight - 20, { align: "center" });

  return pdfNextPage(doc);
}

function pdfStampPages(doc, meta) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...PDF_GRID_COLOR);
    doc.line(PDF_MARGIN, 10, pageWidth - PDF_MARGIN, 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(95, 102, 116);
    doc.text(meta.projectName, PDF_MARGIN, 7.5);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - PDF_MARGIN, pageHeight - 5, { align: "right" });
  }
}

function buildLaborRateRows(labor) {
  return [
    ["Electrician", `$${labor.electrician.toFixed(2)}/hr`],
    ["Low Voltage Technician", `$${labor.lvTech.toFixed(2)}/hr`],
    ["Design / PM", `$${labor.design.toFixed(2)}/hr`],
    ["Electrical Designer", `$${labor.designer.toFixed(2)}/hr`],
    ["Construction Laborer", `$${labor.laborer.toFixed(2)}/hr`],
  ];
}

function buildSingleParameterRows(inputs) {
  const indoorRouting = inputs.installationType === "outdoor" ? "N/A" : inputs.inBuildingType || "N/A";
  const outdoorRouting = inputs.installationType === "indoor" ? "N/A" : inputs.outdoorType || "N/A";
  const outdoorConduit = inputs.installationType === "indoor" ? "N/A" : inputs.outdoorConduitSize || '2"';

  return [
    ["Mode", "Single Location"],
    ["Power Required", `${inputs.powerW} W`],
    ["Distance", `${inputs.distanceFt} ft`],
    ["Crew Size", `${inputs.crewSize} persons`],
    ["Installation Type", inputs.installationType],
    ["In-Building Routing", indoorRouting],
    ["Outdoor Routing", outdoorRouting],
    ["AC Conduit Size (outdoor)", outdoorConduit],
    ["End Device", inputs.endDeviceType],
    ["Conduit Override", inputs.conduitCostOverride > 0 ? `${money(inputs.conduitCostOverride)}/ft` : "Auto by size"],
  ];
}

function buildScenarioSummaryRows(scenarios) {
  return scenarios.map((scenario) => [
    scenarioShortLabel(scenario.name),
    formatScenarioCurrency(scenario),
    formatScenarioCurrency(scenario, scenario.materialTotal),
    formatScenarioCurrency(scenario, scenario.laborTotal),
    formatScenarioNumber(scenario, scenario.totalHours, 1, " hrs"),
    formatScenarioNumber(scenario, scenario.totalDays, 1, " days"),
    isScenarioApplicable(scenario) ? scenario.fitText : scenarioWarningText(scenario),
  ]);
}

function buildCapacityRows(scenarios) {
  return scenarios.map((scenario) => {
    const capacity = scenario.capacity;
    if (!capacity || capacity.applicable === false) {
      return [scenarioShortLabel(scenario.name), "N/A", "N/A", "N/A", scenarioWarningText(scenario)];
    }

    return [
      scenarioShortLabel(scenario.name),
      `${whole(capacity.usedW || 0)} W`,
      `${whole(capacity.remainingW || 0)} W`,
      `${whole(capacity.totalW || 0)} W`,
      `${capacity.totalLabel || "Provisioned"} | ${capacity.basis}`,
    ];
  });
}

function buildPhaseComparisonTable(scenarios) {
  const phaseOrder = [...new Set(scenarios.flatMap((scenario) => scenario.rows.map((row) => row.phase)))];
  return {
    head: ["Phase", ...scenarios.map((scenario) => scenarioShortLabel(scenario.name))],
    body: phaseOrder.map((phase) => {
      const row = [phase];
      scenarios.forEach((scenario) => {
        const phaseCost = scenario.rows
          .filter((item) => item.phase === phase)
          .reduce((sum, item) => sum + item.lineTotal, 0);
        row.push(isScenarioApplicable(scenario) ? money(phaseCost) : "N/A");
      });
      return row;
    }),
  };
}

function buildArchitectureSnapshotRows(scenario) {
  return [
    ["Architecture", scenarioShortLabel(scenario.name)],
    ["Total Cost", formatScenarioCurrency(scenario)],
    ["Material Cost", formatScenarioCurrency(scenario, scenario.materialTotal)],
    ["Labor Cost", formatScenarioCurrency(scenario, scenario.laborTotal)],
    ["Labor Hours", formatScenarioNumber(scenario, scenario.totalHours, 1, " hrs")],
    ["Duration", formatScenarioNumber(scenario, scenario.totalDays, 1, " days")],
    ["Status", isScenarioApplicable(scenario) ? scenario.fitText : scenarioWarningText(scenario)],
  ];
}

function buildArchitectureLineRows(scenario) {
  if (!scenario.rows.length) {
    return [["Status", scenarioWarningText(scenario), "", "", "", "", "", ""]];
  }

  return scenario.rows.map((row) => [
    row.phase.replace(/^\d+\)\s*/, ""),
    row.activity,
    `${row.quantity.toFixed(1)} ${row.unit}`,
    row.laborRole,
    `${row.laborHours.toFixed(1)} hrs`,
    money(row.materialCost),
    money(row.laborCost),
    money(row.lineTotal),
  ]);
}

function buildMultiProjectRows(report) {
  const totalPower = report.perLocation.reduce((sum, location) => sum + location.loc.powerW, 0);
  return [
    ["Mode", "Multi-Location"],
    ["Locations", `${report.perLocation.length}`],
    ["Total Power", `${whole(totalPower)} W`],
    ["Shared Crew Size", `${report.crewSize} persons`],
  ];
}

function buildMultiLocationInputRows(perLocation) {
  return perLocation.map(({ loc }) => [
    loc.name,
    `${loc.powerW} W`,
    `${loc.distanceFt} ft`,
    loc.installationType,
    loc.installationType === "outdoor" ? "N/A" : loc.inBuildingType,
    loc.installationType === "indoor" ? "N/A" : loc.outdoorType,
    loc.installationType === "indoor" ? "N/A" : loc.outdoorConduitSize,
    loc.endDeviceType,
  ]);
}

function buildLocationArchitectureRows(scenarios) {
  return sortScenariosByCost(scenarios).map((scenario) => [
    scenarioShortLabel(scenario.name),
    formatScenarioCurrency(scenario),
    formatScenarioNumber(scenario, scenario.totalDays, 1, " days"),
    isScenarioApplicable(scenario) ? scenario.fitText : scenarioWarningText(scenario),
  ]);
}

function buildLocationLineRows(scenarios) {
  const rows = [];
  sortScenariosByCost(scenarios).forEach((scenario) => {
    if (!scenario.rows.length) {
      rows.push([scenarioShortLabel(scenario.name), "Status", scenarioWarningText(scenario), "", "", "", "", "", ""]);
      return;
    }

    scenario.rows.forEach((row) => {
      rows.push([
        scenarioShortLabel(scenario.name),
        row.phase.replace(/^\d+\)\s*/, ""),
        row.activity,
        `${row.quantity.toFixed(1)} ${row.unit}`,
        row.laborRole,
        `${row.laborHours.toFixed(1)} hrs`,
        money(row.materialCost),
        money(row.laborCost),
        money(row.lineTotal),
      ]);
    });
  });
  return rows;
}

function exportSinglePDF(meta) {
  const doc = createPdfDocument();
  const labor = getLaborRates();
  let y = pdfAddCoverPage(doc, meta, "Power Architecture Cost and Time Comparison Report", [
    ["Mode", "Single Location"],
    ["Power", `${lastInputs.powerW} W`],
    ["Distance", `${lastInputs.distanceFt} ft`],
    ["Crew Size", `${lastInputs.crewSize} persons`],
  ]);

  y = pdfAddTable(doc, "Project Parameters", ["Parameter", "Value"], buildSingleParameterRows(lastInputs), y, { tableWidth: 120 });
  y = pdfAddTable(doc, "Labor Rates", ["Role", "Rate"], buildLaborRateRows(labor), y, { tableWidth: 115 });
  y = pdfAddTable(doc, "Model Assumptions", ["Assumption"], getAssumptions().map((item, index) => [`${index + 1}. ${item}`]), y, {
    styles: { fontSize: 7.6, cellPadding: 2, lineColor: PDF_GRID_COLOR, lineWidth: 0.1, valign: "top" },
  });
  y = pdfAddTable(doc, "Executive Summary", ["Architecture", "Total Cost", "Materials", "Labor", "Hours", "Duration", "Status"], buildScenarioSummaryRows(lastScenarios), y);
  y = pdfAddTable(doc, "Future Capacity Summary", ["Architecture", "Used", "Available", "Provisioned", "Basis / Status"], buildCapacityRows(lastScenarios), y, {
    styles: { fontSize: 7.6, cellPadding: 2, lineColor: PDF_GRID_COLOR, lineWidth: 0.1, valign: "top" },
  });

  const phaseComparison = buildPhaseComparisonTable(lastScenarios);
  y = pdfAddTable(doc, "Phase Cost Comparison", phaseComparison.head, phaseComparison.body, y, {
    styles: { fontSize: 7.4, cellPadding: 1.8, lineColor: PDF_GRID_COLOR, lineWidth: 0.1, valign: "top" },
  });

  lastScenarios.forEach((scenario) => {
    let pageY = pdfNextPage(doc);
    pageY = pdfAddTable(doc, `${scenario.name} Snapshot`, ["Metric", "Value"], buildArchitectureSnapshotRows(scenario), pageY, { tableWidth: 120 });
    pdfAddTable(doc, `${scenario.name} Detailed Line Items`, ["Phase", "Activity", "Qty", "Role", "Hours", "Material $", "Labor $", "Total $"], buildArchitectureLineRows(scenario), pageY, {
      styles: { fontSize: 7.1, cellPadding: 1.4, lineColor: PDF_GRID_COLOR, lineWidth: 0.1, valign: "top" },
      columnStyles: {
        0: { cellWidth: 32 },
        1: { cellWidth: 74 },
        2: { cellWidth: 23 },
        3: { cellWidth: 34 },
        4: { cellWidth: 20 },
        5: { cellWidth: 23 },
        6: { cellWidth: 23 },
        7: { cellWidth: 23 },
      },
    });
  });

  pdfStampPages(doc, meta);
  doc.save(meta.projectName.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_") + "_Report.pdf");
}

function exportMultiPDF(meta) {
  const report = lastMultiReport;
  const doc = createPdfDocument();
  const labor = getLaborRates();
  let y = pdfAddCoverPage(doc, meta, "Multi-Location Power Architecture Comparison Report", [
    ["Mode", "Multi-Location"],
    ["Locations", `${report.perLocation.length}`],
    ["Total Power", `${whole(report.perLocation.reduce((sum, location) => sum + location.loc.powerW, 0))} W`],
    ["Shared Crew Size", `${report.crewSize} persons`],
  ]);

  y = pdfAddTable(doc, "Project Overview", ["Parameter", "Value"], buildMultiProjectRows(report), y, { tableWidth: 120 });
  y = pdfAddTable(doc, "Location Inputs", ["Location", "Power", "Distance", "Installation", "Indoor Routing", "Outdoor Routing", "Conduit", "End Device"], buildMultiLocationInputRows(report.perLocation), y, {
    styles: { fontSize: 7.4, cellPadding: 1.8, lineColor: PDF_GRID_COLOR, lineWidth: 0.1, valign: "top" },
  });
  y = pdfAddTable(doc, "Labor Rates", ["Role", "Rate"], buildLaborRateRows(labor), y, { tableWidth: 115 });
  y = pdfAddTable(doc, "Model Assumptions", ["Assumption"], getAssumptions().map((item, index) => [`${index + 1}. ${item}`]), y, {
    styles: { fontSize: 7.6, cellPadding: 2, lineColor: PDF_GRID_COLOR, lineWidth: 0.1, valign: "top" },
  });
  y = pdfAddTable(doc, "Executive Summary", ["Architecture", "Total Cost", "Materials", "Labor", "Hours", "Duration", "Status"], buildScenarioSummaryRows(report.aggregateScenarios), y);

  const grandTotals = buildPhaseComparisonTable(report.aggregateScenarios);
  y = pdfAddTable(doc, "Project Grand Totals by Phase", grandTotals.head, grandTotals.body, y, {
    styles: { fontSize: 7.4, cellPadding: 1.8, lineColor: PDF_GRID_COLOR, lineWidth: 0.1, valign: "top" },
  });

  report.perLocation.forEach(({ loc, scenarios }) => {
    let pageY = pdfNextPage(doc);
    pageY = pdfAddTable(doc, `${loc.name} Project Inputs`, ["Parameter", "Value"], [
      ["Power", `${loc.powerW} W`],
      ["Distance", `${loc.distanceFt} ft`],
      ["Installation Type", loc.installationType],
      ["In-Building Routing", loc.installationType === "outdoor" ? "N/A" : loc.inBuildingType],
      ["Outdoor Routing", loc.installationType === "indoor" ? "N/A" : loc.outdoorType],
      ["AC Conduit Size (outdoor)", loc.installationType === "indoor" ? "N/A" : loc.outdoorConduitSize],
      ["End Device", loc.endDeviceType],
    ], pageY, { tableWidth: 120 });
    pageY = pdfAddTable(doc, `${loc.name} Architecture Summary`, ["Architecture", "Total Cost", "Duration", "Status"], buildLocationArchitectureRows(scenarios), pageY, {
      tableWidth: 170,
    });
    pageY = pdfAddTable(doc, `${loc.name} Capacity Summary`, ["Architecture", "Used", "Available", "Provisioned", "Basis / Status"], buildCapacityRows(sortScenariosByCost(scenarios)), pageY, {
      styles: { fontSize: 7.6, cellPadding: 2, lineColor: PDF_GRID_COLOR, lineWidth: 0.1, valign: "top" },
    });
    pdfAddTable(doc, `${loc.name} Line Item Detail`, ["Architecture", "Phase", "Activity", "Qty", "Role", "Hours", "Material $", "Labor $", "Total $"], buildLocationLineRows(scenarios), pageY, {
      styles: { fontSize: 6.9, cellPadding: 1.2, lineColor: PDF_GRID_COLOR, lineWidth: 0.1, valign: "top" },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 28 },
        2: { cellWidth: 58 },
        3: { cellWidth: 19 },
        4: { cellWidth: 28 },
        5: { cellWidth: 18 },
        6: { cellWidth: 21 },
        7: { cellWidth: 21 },
        8: { cellWidth: 21 },
      },
    });
  });

  pdfStampPages(doc, meta);
  doc.save(meta.projectName.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_") + "_Report.pdf");
}

function exportPDF() {
  if (lastGeneratedMode === "multi") {
    if (!lastMultiReport) { alert("Generate a multi-location comparison first."); return; }
  } else if (!lastScenarios || !lastInputs) {
    alert("Generate a comparison first.");
    return;
  }

  if (typeof window.jspdf === "undefined") { alert("PDF library not loaded. Verify the local vendor files are available."); return; }

  const meta = getExportMeta();
  if (lastGeneratedMode === "multi") exportMultiPDF(meta);
  else exportSinglePDF(meta);
}

function exportExcel() {
  if (lastGeneratedMode === "multi") {
    alert("Excel export is currently available for single-location reports only.");
    return;
  }
  if (!lastScenarios || !lastInputs) { alert("Generate a comparison first."); return; }
  if (typeof XLSX === "undefined") { alert("Excel library not loaded. Verify the local vendor files are available."); return; }

  const meta = getExportMeta();
  const wb = XLSX.utils.book_new();

  // ─── Sheet 1: Summary ─────────────────────────────────
  const summaryData = [
    [meta.projectName],
    ["Power Architecture Cost & Time Analysis"],
    [],
    ["Customer:", meta.customerName],
    ["Prepared By:", meta.preparedBy],
    ["Date:", meta.date],
    [],
    ["PROJECT PARAMETERS"],
    ["Power Required", `${lastInputs.powerW} W`],
    ["Distance", `${lastInputs.distanceFt} ft`],
    ["Crew Size", `${lastInputs.crewSize} persons`],
    ["Installation Type", lastInputs.installationType],
    ["In-Building Routing", lastInputs.inBuildingType || "N/A"],
    ["Outdoor Routing", lastInputs.outdoorType || "N/A"],
    ["AC Conduit Size (outdoor)", lastInputs.outdoorConduitSize || "2\""],
    ["End Device", lastInputs.endDeviceType],
    [],
    ["LABOR RATES"],
  ];

  const labor = getLaborRates();
  summaryData.push(["Electrician", labor.electrician]);
  summaryData.push(["Low Voltage Technician", labor.lvTech]);
  summaryData.push(["Design / PM", labor.design]);
  summaryData.push(["Electrical Designer", labor.designer]);
  summaryData.push(["Construction Laborer", labor.laborer]);
  summaryData.push([]);
  summaryData.push(["ASSUMPTIONS"]);
  getAssumptions().forEach((a, i) => summaryData.push([`${i + 1}.`, a]));
  summaryData.push([]);
  summaryData.push(["EXECUTIVE SUMMARY"]);
  summaryData.push(["Architecture", "Total Cost", "Materials", "Labor", "Hours", "Days", "Fit Assessment"]);
  lastScenarios.forEach((s) => {
    summaryData.push([
      s.name,
      isScenarioApplicable(s) ? s.totalCost : "N/A",
      isScenarioApplicable(s) ? s.materialTotal : "N/A",
      isScenarioApplicable(s) ? s.laborTotal : "N/A",
      isScenarioApplicable(s) ? s.totalHours : "N/A",
      isScenarioApplicable(s) ? s.totalDays : "N/A",
      s.fitText,
    ]);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  ws1["!cols"] = [{ wch: 25 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Summary");

  // ─── Sheet per architecture ───────────────────────────
  lastScenarios.forEach((scenario) => {
    const data = [
      [`${scenario.name} — Line Item Detail`],
      [`Total Cost: ${formatScenarioCurrency(scenario)}`],
      [
        isScenarioApplicable(scenario)
          ? `Duration: ${formatScenarioNumber(scenario, scenario.totalDays, 1, " calendar days")} (${formatScenarioNumber(scenario, scenario.totalHours, 1, " labor hours")})`
          : `Status: ${scenarioWarningText(scenario)}`
      ],
      [],
      ["Phase", "Activity", "Description", "Quantity", "Unit", "Labor Role", "Labor Hours", "Labor Rate ($/hr)", "Material Cost ($)", "Labor Cost ($)", "Line Total ($)", "Milestone"],
    ];

    if (scenario.rows.length) {
      scenario.rows.forEach((r) => {
        data.push([
          r.phase,
          r.activity,
          r.description,
          r.quantity,
          r.unit,
          r.laborRole,
          r.laborHours,
          r.laborRate,
          r.materialCost,
          r.laborCost,
          r.lineTotal,
          r.milestone,
        ]);
      });
    } else {
      data.push(["Status", scenarioWarningText(scenario)]);
    }

    // Phase subtotals
    data.push([]);
    data.push(["PHASE SUBTOTALS"]);
    data.push(["Phase", "", "", "", "", "", "Hours", "", "Materials", "Labor", "Total"]);
    const phases = [...new Set(scenario.rows.map((r) => r.phase))];
    phases.forEach((phase) => {
      const phaseRows = scenario.rows.filter((r) => r.phase === phase);
      const hrs = phaseRows.reduce((s, r) => s + r.laborHours, 0);
      const mat = phaseRows.reduce((s, r) => s + r.materialCost, 0);
      const lab = phaseRows.reduce((s, r) => s + r.laborCost, 0);
      data.push([phase, "", "", "", "", "", hrs, "", mat, lab, mat + lab]);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [
      { wch: 32 }, { wch: 35 }, { wch: 45 }, { wch: 10 }, { wch: 6 },
      { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 },
    ];

    const sheetName = scenario.name.length > 31 ? scenario.name.slice(0, 31) : scenario.name;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  // ─── Phase Comparison Sheet ───────────────────────────
  const phaseOrder = [...new Set(lastScenarios.flatMap((s) => s.rows.map((r) => r.phase)))];
  const compData = [
    ["Phase Cost Comparison"],
    [],
    ["Phase", ...lastScenarios.map((s) => s.name + " ($)"), ...lastScenarios.map((s) => s.name + " (Days)")],
  ];

  phaseOrder.forEach((phase) => {
    const row = [phase];
    lastScenarios.forEach((s) => {
      row.push(isScenarioApplicable(s) ? s.rows.filter((r) => r.phase === phase).reduce((sum, r) => sum + r.lineTotal, 0) : "N/A");
    });
    lastScenarios.forEach((s) => {
      const phaseRows = s.rows.filter((r) => r.phase === phase);
      const hrs = phaseRows.reduce((sum, r) => sum + r.laborHours, 0);
      const days = DESIGN_PHASES.has(phase) ? hrs / 8 : hrs / 8 / s.crewSize;
      row.push(isScenarioApplicable(s) ? parseFloat(days.toFixed(1)) : "N/A");
    });
    compData.push(row);
  });

  // Totals row
  const totalRow = ["TOTAL"];
  lastScenarios.forEach((s) => totalRow.push(isScenarioApplicable(s) ? s.totalCost : "N/A"));
  lastScenarios.forEach((s) => totalRow.push(isScenarioApplicable(s) ? parseFloat(s.totalDays.toFixed(1)) : "N/A"));
  compData.push(totalRow);

  const ws4 = XLSX.utils.aoa_to_sheet(compData);
  ws4["!cols"] = [{ wch: 35 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws4, "Phase Comparison");

  // Save
  const filename = meta.projectName.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_") + "_Report.xlsx";
  XLSX.writeFile(wb, filename);
}

// ─── Mode Toggle ──────────────────────────────────────────────────────────────
let currentMode = "single";

function setMode(mode) {
  currentMode = mode;
  document.getElementById("modeSingle").classList.toggle("active", mode === "single");
  document.getElementById("modeMulti").classList.toggle("active", mode === "multi");
  document.getElementById("singleLocationSection").style.display = mode === "single" ? "grid" : "none";
  document.getElementById("multiLocationSection").style.display = mode === "multi" ? "grid" : "none";
  document.getElementById("outputArea").classList.add("output-hidden");
  document.getElementById("multiOutputArea").classList.add("output-hidden");
  setGenerateButtonLabel();
  renderSectionNav();
}

document.getElementById("modeSingle").addEventListener("click", () => setMode("single"));
document.getElementById("modeMulti").addEventListener("click", () => setMode("multi"));
document.getElementById("sectionNavList").addEventListener("click", (event) => {
  const link = event.target.closest(".section-nav-link");
  if (!link) return;

  event.preventDefault();
  const target = document.getElementById(link.dataset.target);
  if (!target) return;

  target.scrollIntoView({ behavior: "auto", block: "start" });
  setActiveSectionNav(link.dataset.target);
});
window.addEventListener("scroll", updateActiveSectionNav, { passive: true });
window.addEventListener("resize", renderSectionNav);

// ─── Multi-Location Management ────────────────────────────────────────────────
let locationIdCounter = 0;
let locations = [];

function createLocationCard(loc) {
  const card = document.createElement("div");
  card.className = "location-card";
  card.dataset.locId = loc.id;

  card.innerHTML = `
    <div class="location-card-header">
      <h4><input type="text" class="loc-name" value="${loc.name}" placeholder="Location name" style="border:none;font-weight:700;font-size:0.95rem;font-family:inherit;padding:0;width:180px;background:transparent;" /></h4>
      <button type="button" class="remove-location-btn">Remove</button>
    </div>
    <div class="control-grid">
      <label>
        Power Required
        <div class="input-wrap">
          <input type="number" class="loc-power" min="10" max="15000" value="${loc.powerW}" step="10" />
          <span>W</span>
        </div>
      </label>
      <label>
        Distance from MDF
        <div class="input-wrap">
          <input type="number" class="loc-distance" min="25" max="5000" value="${loc.distanceFt}" step="25" />
          <span>ft</span>
        </div>
      </label>
    </div>
    <div class="control-grid" style="margin-top:0.5rem;">
      <label>
        Installation Type
        <select class="loc-install-type">
          <option value="indoor"${loc.installationType === "indoor" ? " selected" : ""}>Indoor</option>
          <option value="outdoor"${loc.installationType === "outdoor" ? " selected" : ""}>Outdoor</option>
          <option value="mixed"${loc.installationType === "mixed" ? " selected" : ""}>Mixed</option>
        </select>
      </label>
      <label class="loc-indoor-group">
        In-Building Routing
        <select class="loc-indoor-routing">
          <option value="idf"${loc.inBuildingType === "idf" ? " selected" : ""}>Open Riser</option>
          <option value="plenum"${loc.inBuildingType === "plenum" ? " selected" : ""}>Plenum Space</option>
          <option value="open-tray"${loc.inBuildingType === "open-tray" ? " selected" : ""}>Open Cable Tray</option>
          <option value="j-hooks"${loc.inBuildingType === "j-hooks" ? " selected" : ""}>J-Hooks on Beam</option>
          <option value="surface"${loc.inBuildingType === "surface" ? " selected" : ""}>Surface Mount</option>
        </select>
      </label>
      <label class="loc-outdoor-group">
        Outdoor Routing
        <select class="loc-outdoor-routing">
          <option value="direct-bury"${loc.outdoorType === "direct-bury" ? " selected" : ""}>Direct Bury</option>
          <option value="conduit-bury"${loc.outdoorType === "conduit-bury" ? " selected" : ""}>Conduit Buried</option>
          <option value="aerial"${loc.outdoorType === "aerial" ? " selected" : ""}>Aerial/Pole-Mount</option>
          <option value="wall-mount"${loc.outdoorType === "wall-mount" ? " selected" : ""}>Wall Mount</option>
          <option value="underground-duct"${loc.outdoorType === "underground-duct" ? " selected" : ""}>Underground Duct</option>
        </select>
      </label>
      <label class="loc-outdoor-group loc-outdoor-conduit-group">
        AC Conduit Size (outdoor)
        <select class="loc-outdoor-conduit">
          <option value='3/4"'${loc.outdoorConduitSize === '3/4"' ? " selected" : ""}>3/4"</option>
          <option value='1"'${loc.outdoorConduitSize === '1"' ? " selected" : ""}>1"</option>
          <option value='1-1/4"'${loc.outdoorConduitSize === '1-1/4"' ? " selected" : ""}>1-1/4"</option>
          <option value='2"'${(loc.outdoorConduitSize === '2"' || !loc.outdoorConduitSize) ? " selected" : ""}>2"</option>
          <option value='4"'${loc.outdoorConduitSize === '4"' ? " selected" : ""}>4"</option>
        </select>
      </label>
      <label>
        End Device
        <select class="loc-end-device">
          <option value="switch"${loc.endDeviceType === "switch" ? " selected" : ""}>Network Switch</option>
          <option value="media-converter"${loc.endDeviceType === "media-converter" ? " selected" : ""}>Media Converter</option>
          <option value="direct"${loc.endDeviceType === "direct" ? " selected" : ""}>Direct to Device</option>
        </select>
      </label>
    </div>
  `;

  card.querySelector(".remove-location-btn").addEventListener("click", () => {
    locations = locations.filter((l) => l.id !== loc.id);
    card.remove();
  });

  card.querySelector(".loc-install-type").addEventListener("change", () => {
    syncLocationCardRoutingFields(card);
  });

  syncLocationCardRoutingFields(card);

  return card;
}

function syncLocationCardRoutingFields(card) {
  const installType = card.querySelector(".loc-install-type").value;
  const indoorGroup = card.querySelector(".loc-indoor-group");
  const outdoorGroups = card.querySelectorAll(".loc-outdoor-group");

  if (indoorGroup) {
    indoorGroup.style.display = installType === "outdoor" ? "none" : "grid";
  }

  outdoorGroups.forEach((group) => {
    group.style.display = installType === "indoor" ? "none" : "grid";
  });
}

function buildAggregateScenarios(perLocation, crewSize) {
  const archNames = ["Class 1 AC", "Class 2 DC", "Class 4 Fault Managed Power"];

  return sortScenariosByCost(archNames.map((archName) => {
    const locationScenarios = perLocation
      .map(({ scenarios }) => scenarios.find((scenario) => scenario.name === archName))
      .filter(Boolean);
    const unavailableScenario = locationScenarios.find((scenario) => !isScenarioApplicable(scenario));

    if (unavailableScenario) {
      return {
        name: archName,
        rows: [],
        totalCost: 0,
        totalHours: 0,
        totalDays: 0,
        materialTotal: 0,
        laborTotal: 0,
        crewSize,
        fit: unavailableScenario.fit || "warn",
        fitText: unavailableScenario.fitText || "Not applicable",
        isApplicable: false,
        unavailabilityReason: scenarioWarningText(unavailableScenario),
        unavailabilityShortText: scenarioWarningShortText(unavailableScenario),
      };
    }

    const rows = locationScenarios.flatMap((scenario) => scenario.rows.map((row) => ({ ...row })));
    return {
      name: archName,
      rows,
      totalCost: locationScenarios.reduce((sum, scenario) => sum + scenario.totalCost, 0),
      totalHours: locationScenarios.reduce((sum, scenario) => sum + scenario.totalHours, 0),
      totalDays: locationScenarios.reduce((sum, scenario) => sum + scenario.totalDays, 0),
      materialTotal: locationScenarios.reduce((sum, scenario) => sum + scenario.materialTotal, 0),
      laborTotal: locationScenarios.reduce((sum, scenario) => sum + scenario.laborTotal, 0),
      crewSize,
      fit: "good",
      fitText: "Project total",
    };
  }));
}

function addLocation() {
  locationIdCounter++;
  const loc = {
    id: locationIdCounter,
    name: `IDF-${locationIdCounter}`,
    powerW: 1000,
    distanceFt: 500,
    installationType: "indoor",
    inBuildingType: "idf",
    outdoorType: "direct-bury",
    outdoorConduitSize: '2"',
    endDeviceType: "switch",
  };
  locations.push(loc);
  const card = createLocationCard(loc);
  document.getElementById("locationList").appendChild(card);
}

function readLocationsFromDOM() {
  const cards = document.querySelectorAll(".location-card");
  return Array.from(cards).map((card) => {
    return {
      name: card.querySelector(".loc-name").value || "Unnamed",
      powerW: clamp(Number(card.querySelector(".loc-power").value) || 1000, 10, 15000),
      distanceFt: clamp(Number(card.querySelector(".loc-distance").value) || 500, 25, 5000),
      installationType: card.querySelector(".loc-install-type").value,
      inBuildingType: card.querySelector(".loc-indoor-routing").value,
      outdoorType: card.querySelector(".loc-outdoor-routing").value,
      outdoorConduitSize: card.querySelector(".loc-outdoor-conduit").value,
      endDeviceType: card.querySelector(".loc-end-device").value,
    };
  });
}

function runMultiModel() {
  const labor = getLaborRates();
  const crewSize = clamp(Number(document.getElementById("multiCrewSize").value) || 3, 1, 20);
  const conduitCostOverride = clamp(Number(document.getElementById("conduitCostPerFt").value) || 0, 0, 50);
  const locs = readLocationsFromDOM();

  if (locs.length === 0) return;

  // Run per-location scenarios
  const perLocation = locs.map((loc) => {
    const scenarios = buildComparison(
      loc.powerW, loc.distanceFt, labor, crewSize, conduitCostOverride,
      loc.installationType, loc.inBuildingType, loc.outdoorType, loc.endDeviceType, loc.outdoorConduitSize
    );
    return { loc, scenarios };
  });

  // Aggregate totals per architecture
  const archTotals = {
    "Class 1 AC": { cost: 0, days: 0, applicable: true, warningText: "" },
    "Class 2 DC": { cost: 0, days: 0, applicable: true, warningText: "" },
    "Class 4 Fault Managed Power": { cost: 0, days: 0, applicable: true, warningText: "" },
  };
  perLocation.forEach(({ scenarios }) => {
    scenarios.forEach((s) => {
      if (archTotals[s.name]) {
        if (!isScenarioApplicable(s)) {
          archTotals[s.name].applicable = false;
          archTotals[s.name].warningText = scenarioWarningText(s);
          archTotals[s.name].cost = 0;
          archTotals[s.name].days = 0;
          return;
        }
        if (archTotals[s.name].applicable === false) return;
        archTotals[s.name].cost += s.totalCost;
        archTotals[s.name].days += s.totalDays;
      }
    });
  });

  const aggregateScenarios = buildAggregateScenarios(perLocation, crewSize);
  renderMultiSummary(perLocation, archTotals, crewSize);
  renderMultiBreakdown(perLocation);
  renderMultiGrandTotals(aggregateScenarios);
  captureMultiExportData(perLocation, archTotals, crewSize, aggregateScenarios);

  hasGenerated = true;
  document.getElementById("multiOutputArea").classList.remove("output-hidden");
  showExportPackage();
  renderSectionNav();
  setProjectLocked(true);
  document.getElementById("exportPackage").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderMultiSummary(perLocation, archTotals, crewSize) {
  const totalLocations = perLocation.length;
  const totalPowerW = perLocation.reduce((s, p) => s + p.loc.powerW, 0);

  const archEntries = Object.entries(archTotals).sort((a, b) => {
    const aCost = a[1].applicable === false ? Number.POSITIVE_INFINITY : a[1].cost;
    const bCost = b[1].applicable === false ? Number.POSITIVE_INFINITY : b[1].cost;
    return aCost - bCost;
  });
  const applicableEntries = archEntries.filter(([, data]) => data.applicable !== false);
  const lowestCost = applicableEntries.length ? applicableEntries[0][1].cost : 0;

  const archCards = archEntries.map(([name, data]) => {
    const arch = scenarioArchKey(name);
    const isCheapest = data.applicable !== false && data.cost === lowestCost;
    const cheapClass = isCheapest ? " cheapest" : "";
    const badge = isCheapest ? `<div class="snap-badges"><span class="snap-badge good">Lowest Total</span></div>` : "";
    return `
      <article class="metric scenario-metric${cheapClass}" data-arch="${arch}">
        <p class="scenario-metric-name">${name}</p>
        <h3>${data.applicable === false ? "N/A" : money(data.cost)}</h3>
        <p>${data.applicable === false ? data.warningText : `${num(data.days, 1)} total calendar days`}</p>
        ${badge}
      </article>
    `;
  }).join("");

  document.getElementById("multiSummary").innerHTML = `
    <h2>Multi-Location Project Summary</h2>
    <div class="metrics snapshot-context">
      <article class="metric">
        <p>Locations</p>
        <h3>${totalLocations} IDF${totalLocations > 1 ? "s" : ""}</h3>
      </article>
      <article class="metric">
        <p>Total Power</p>
        <h3>${num(totalPowerW, 0)} W</h3>
      </article>
      <article class="metric">
        <p>Crew Size</p>
        <h3>${crewSize} persons</h3>
      </article>
    </div>
    <div class="metrics snapshot-scenarios">${archCards}</div>
  `;
}

function renderMultiGantt(scenarios) {
  const phaseOrder = [...new Set(scenarios.flatMap((s) => s.rows.map((r) => r.phase)))];
  const applicableScenarios = scenarios.filter(isScenarioApplicable);
  const maxDays = applicableScenarios.length ? Math.max(...applicableScenarios.map((s) => s.totalDays)) : 1;

  const trackHtml = scenarios.map((scenario) => {
    const applicable = isScenarioApplicable(scenario);
    const trackBars = phaseOrder.map((phase, pi) => {
      const phaseRows = scenario.rows.filter((r) => r.phase === phase);
      const rawHours = phaseRows.reduce((sum, r) => sum + r.laborHours, 0);
      const days = DESIGN_PHASES.has(phase) ? rawHours / 8 : rawHours / 8 / scenario.crewSize;
      const pct = maxDays > 0 ? (days / maxDays) * 100 : 0;
      const short = PHASE_NAMES_SHORT[phase] || phase;
      const colorClass = GANTT_COLORS[pi % GANTT_COLORS.length];
      return { short, days, pct, colorClass, phase };
    }).filter((b) => applicable && b.days > 0);

    const barHtml = trackBars.map((b) => `
      <div class="gantt-bar ${b.colorClass}" style="width:${b.pct}%" title="${b.phase}: ${num(b.days,1)} days">
        ${b.pct > 10 ? b.short : ""}
      </div>
    `).join("");

    const label = scenarioArchKey(scenario.name) === "ac" ? "AC"
      : scenarioArchKey(scenario.name) === "cl2" ? "CL2" : "CL4";
    return `
      <div class="gantt-scenario gantt-mini">
        <div class="gantt-label-row">
          <span class="gantt-scenario-name">${label}</span>
          <span class="gantt-total-label">${applicable ? `${num(scenario.totalDays,1)} days` : "N/A"}</span>
        </div>
        <div class="gantt-track">${barHtml}</div>
      </div>
    `;
  }).join("");

  return `<div class="gantt-wrap gantt-mini-wrap">${trackHtml}</div>`;
}

function renderMultiBreakdown(perLocation) {
  const html = perLocation.map(({ loc, scenarios }) => {
    const sorted = sortScenariosByCost(scenarios);
    const pills = sorted.map((s) => {
      const applicable = isScenarioApplicable(s);
      const arch = scenarioArchKey(s.name);
      const label = arch === "ac" ? "CL1 AC" : arch === "cl2" ? "CL2 DC" : "CL4 FMP";
      return `
        <div class="loc-arch-pill" data-arch="${arch}">
          <div class="pill-label">${label}</div>
          <div class="pill-cost">${formatScenarioCurrency(s)}</div>
          <div class="pill-days">${applicable ? `${num(s.totalDays, 1)} days` : scenarioWarningShortText(s)}</div>
        </div>
      `;
    }).join("");

    const ganttHtml = renderMultiGantt(scenarios);
    const lineItemHtml = buildPhaseSectionsHtml(sorted);
    const capacityHtml = buildCapacityBarChartHtml(sorted);

    return `
      <div class="loc-breakdown-card">
        <h4>${loc.name}</h4>
        <div class="loc-meta">
          <span>${loc.powerW} W</span>
          <span>${loc.distanceFt} ft</span>
          <span>${loc.installationType}</span>
        </div>
        <div class="loc-arch-pills">${pills}</div>
        <div class="loc-section-block loc-line-items">
          <div class="section-head section-head-compact">
            <h5>Line Item Breakout</h5>
            <p>Phase-by-phase cost breakout for this location.</p>
          </div>
          ${lineItemHtml}
        </div>
        <div class="loc-section-block loc-capacity-chart">
          <div class="section-head section-head-compact">
            <h5>Future Capacity Bars</h5>
            <p>Remaining capacity view by architecture for this location.</p>
          </div>
          ${capacityHtml}
        </div>
        <div class="loc-gantt">${ganttHtml}</div>
      </div>
    `;
  }).join("");

  document.getElementById("multiLocationBreakdown").innerHTML = `
    <div class="section-head">
      <h2>Per-Location Breakdown</h2>
      <p>Cost and time for each IDF location across all three architectures.</p>
    </div>
    ${html}
  `;
}

function renderMultiGrandTotals(aggregateScenarios) {
  const container = document.getElementById("multiGrandTotals");
  if (!container) return;

  container.innerHTML = `
    <div class="section-head">
      <h2>Project Grand Totals by Phase</h2>
      <p>Aggregated line-item totals across all locations for each power architecture.</p>
    </div>
    ${buildPhaseSectionsHtml(aggregateScenarios)}
  `;
}

// Initialize with 2 default locations
addLocation();
addLocation();

document.getElementById("addLocationBtn").addEventListener("click", addLocation);

// ─── Single-Location Event Listeners ──────────────────────────────────────────
document.getElementById("calculateProjectBtn").addEventListener("click", () => {
  if (currentMode === "multi") runMultiModel();
  else generateOutput();
});
document.getElementById("resetRatesBtn").addEventListener("click", () => {
  resetLaborRates();
  maybeRunModel();
});
document.getElementById("rateElectrician").addEventListener("input", maybeRunModel);
document.getElementById("rateLvTech").addEventListener("input", maybeRunModel);
document.getElementById("rateDesign").addEventListener("input", maybeRunModel);
document.getElementById("rateDesigner").addEventListener("input", maybeRunModel);
document.getElementById("rateLaborer").addEventListener("input", maybeRunModel);
document.getElementById("crewSize").addEventListener("input", maybeRunModel);
document.getElementById("conduitCostPerFt").addEventListener("input", maybeRunModel);
document.getElementById("installationType").addEventListener("change", handleInstallationTypeChange);

// Normalize numeric inputs on blur/change so clamping doesn't disrupt typing
normalizeNumericInput("powerW", 10, 15000, 0);
normalizeNumericInput("distanceFt", 25, 5000, 0);
normalizeNumericInput("crewSize", 1, 20, 1);
normalizeNumericInput("conduitCostPerFt", 0, 50, 0);
normalizeNumericInput("rateElectrician", 10, 250, defaultLabor.electrician);
normalizeNumericInput("rateLvTech", 10, 250, defaultLabor.lvTech);
normalizeNumericInput("rateDesign", 10, 250, defaultLabor.design);
normalizeNumericInput("rateDesigner", 10, 250, defaultLabor.designer);
normalizeNumericInput("rateLaborer", 10, 250, defaultLabor.laborer);

// ─── Export Event Listeners ───────────────────────────────────────────────────
document.getElementById("clearProjectBtn").addEventListener("click", clearProject);
document.getElementById("exportPdfBtn").addEventListener("click", exportPDF);
document.getElementById("exportExcelBtn").addEventListener("click", exportExcel);

setGenerateButtonLabel();
renderSectionNav();
