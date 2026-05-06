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
  const sizes = {
    '3/4"':   { size: '3/4"',   rate: 0.90,  laborPerFt: 0.06 },
    '1"':     { size: '1"',     rate: 1.50,  laborPerFt: 0.08 },
    '1-1/4"': { size: '1-1/4"', rate: 2.50,  laborPerFt: 0.10 },
    '2"':     { size: '2"',     rate: 4.50,  laborPerFt: 0.14 },
    '4"':     { size: '4"',     rate: 18.00, laborPerFt: 0.22 },
  };
  if (sizeOverride && sizes[sizeOverride]) return sizes[sizeOverride];
  return sizes['2"']; // default for all AC power
}

// Conductor count: 1-phase (≤2000W) = 3 wires (H+N+G), 3-phase (>2000W) = 5 wires (3P+N+G)
function conductorCount(powerW) {
  return powerW <= 2000 ? 3 : 5;
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
      materials: [material(`Conduit ${conduitSize} EMT${useConduitOverride ? " (installed)" : ""}`, conduitFt, "ft", conduitAllInPerFt)],
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

  return summarize("Class 1 AC", lineItems, {
    fit: distanceFt <= 150 || powerW > 10000 ? "good" : "warn",
    fitText:
      distanceFt <= 150
        ? "Strong fit for short runs"
        : powerW > 10000
        ? "Required for very high power loads"
        : "Higher cost and time as distance grows",
  }, crewSize);
}

function calculateClass2(powerW, distanceFt, labor, crewSize, installationType, outdoorType) {
  // Class 2 limit is 1750ft; clamp distance
  const cl2Dist = Math.min(distanceFt, 1750);

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

  return summarize("Class 2 DC", lineItems, {
    fit: distanceFt > 1750 ? "bad" : (powerW <= 100 && distanceFt <= 300 ? "good" : "warn"),
    fitText:
      distanceFt > 1750
        ? `Distance exceeds Class 2 limit (1750 ft) — not applicable`
        : powerW <= 100 && distanceFt <= 300
        ? "Best for low-power and shorter spans"
        : "Parallel runs increase cost at higher loads",
  }, crewSize);
}

function calculateClass4(powerW, distanceFt, labor, crewSize, installationType, outdoorType) {
  // FMP Class 4: always 16AWG cable
  // Pair count is distance-dependent — longer runs need more pairs to stay within voltage/current budget
  // FMP operates at up to 450VDC; each pair carries limited current per safety class
  // Typical: ~2.8A max per conductor pair (Class 4 safety limit)
  // Power per pair = 450V × 2.8A × efficiency (~0.92) = ~1160W at short distance
  // At longer distances, derate for voltage drop: 16AWG = 0.004016 Ω/ft
  // Vdrop per pair = I × 2 × 0.004016 × dist; usable voltage = 450 - Vdrop
  // Effective watts per pair = (450 - Vdrop) × 2.8 × 0.92
  const cl4CurrentPerPair = 2.8;
  const cl4Voltage = 450;
  const cl4Efficiency = 0.92;
  const cl4OhmsPerFt = 0.004016; // 16AWG
  const cl4Vdrop = cl4CurrentPerPair * 2 * cl4OhmsPerFt * distanceFt;
  const cl4EffectiveVoltage = Math.max(cl4Voltage * 0.8, cl4Voltage - cl4Vdrop); // min 80% voltage
  const wattsPerPair = cl4EffectiveVoltage * cl4CurrentPerPair * cl4Efficiency;
  const cl4Pairs = Math.max(1, Math.ceil(powerW / wattsPerPair));
  const cl4TotalConductors = cl4Pairs * 2;

  const channels = Math.max(1, Math.ceil(powerW / 1300));
  // CL4 cable pricing per foot (whole cable assembly): 1-pair=$1.10, 2-pair=$1.22, 3-pair=$1.36
  const cl4CableRatePerFt = cl4Pairs <= 1 ? 1.10 : cl4Pairs <= 2 ? 1.22 : 1.36;
  const cl4CableFt = distanceFt * 1.1; // cable run length with 10% slack
  const cl4RunFt = distanceFt * 1.1; // pathway run length
  const receiverQty = Math.max(1, Math.ceil(powerW / 1500));
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
      activity: "FMP transmitter / head-end installation",
      description: "Install head-end chassis, PSU modules, and channel cards",
      quantity: channels,
      unit: "ch",
      laborUnits: 1.5,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("Class 4 head-end channel allocation", channels, "ch", 2600)],
      milestone: "Head-end installed",
    }),
    createLineItem({
      phase: "4) Power Equipment Install",
      activity: "FMP receiver hardware deployment",
      description: "Install receiver endpoints and verify power output",
      quantity: receiverQty,
      unit: "ea",
      laborUnits: 1.0,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material("Class 4 receiver", receiverQty, "ea", 1650)],
      milestone: "Receivers installed",
    }),
    createLineItem({
      phase: "5) Cable Installation and Termination",
      activity: "CL4 copper cable installation",
      description: `Install ${cl4Pairs} pair${cl4Pairs > 1 ? "s" : ""} (${cl4TotalConductors}× #16 AWG) Class 4 power conductors`,
      quantity: cl4CableFt,
      unit: "ft",
      laborUnits: 1 / 110,
      laborRate: labor.lvTech,
      laborRole: "Low Voltage Technician",
      materials: [material(`${cl4Pairs}-pair #16 AWG CL4 cable`, cl4CableFt, "ft", cl4CableRatePerFt)],
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

  return summarize("Class 4 Fault Managed Power", lineItems, {
    fit: powerW <= 4500 ? "good" : "warn",
    fitText:
      powerW <= 4500
        ? "Strong fit for medium-to-high power over long runs"
        : "Above 4.5 kW may require AC architecture",
  }, crewSize);
}

function summarize(name, lineItems, fitMeta, crewSize = 1) {
  let materialTotal = 0;
  let laborTotal = 0;
  let hoursTotal = 0;
  let designHours = 0;
  let installHours = 0;

  const rows = lineItems.map((x) => {
    const materialCost = x.materials.reduce((sum, m) => sum + m.qty * m.unitCost, 0);
    const laborCost = x.laborHours * x.laborRate;
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
    scenario.totalCost = applyInputMultipliers(scenario, installationType, inBuildingType, outdoorType, endDeviceType);
  });

  scenarios.sort((a, b) => a.totalCost - b.totalCost);
  return scenarios;
}

function renderSummary(scenarios, powerW, distanceFt, crewSize) {
  const sorted = [...scenarios].sort((a, b) => a.totalCost - b.totalCost);
  const lowestCost = sorted[0].totalCost;
  const fastestDays = Math.min(...scenarios.map((s) => s.totalDays));

  const scenarioCards = scenarios.map((s) => {
    const isCheapest = s.totalCost === lowestCost;
    const isFastest = s.totalDays === fastestDays;
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
        <h3>${money(s.totalCost)}</h3>
        <p>${num(s.totalDays, 1)} calendar days</p>
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

function renderPhaseSections(scenarios) {
  const phaseOrder = [...new Set(scenarios.flatMap((s) => s.rows.map((r) => r.phase)))];
  const labels = scenarios.map((s) => scenarioShortLabel(s.name));

  const html = phaseOrder
    .map((phase) => {
      const cards = scenarios
        .map((scenario) => {
          const phaseRows = scenario.rows.filter((r) => r.phase === phase);
          const phaseCost = phaseRows.reduce((sum, r) => sum + r.lineTotal, 0);
          const rawHours = phaseRows.reduce((sum, r) => sum + r.laborHours, 0);
          const phaseDays = DESIGN_PHASES.has(phase)
            ? rawHours / 8
            : rawHours / 8 / scenario.crewSize;

          return `
            <article class="option-pill" data-arch="${scenarioArchKey(scenario.name)}">
              <h4>${scenario.name}</h4>
              <p><strong>Phase Cost:</strong> ${money(phaseCost)}</p>
              <p><strong>Phase Time:</strong> ${num(phaseDays, 1)} days</p>
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
      const totalCells = colTotals.map((t) => `<td class="task-check task-cost task-total">${money(t)}</td>`).join("");
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

  document.getElementById("phaseBreakdown").innerHTML = `<div class="phase-grid">${html}</div>`;
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
  const maxDays = Math.max(...scenarios.map((s) => s.totalDays));

  const bars = scenarios.map((scenario) => {
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
    }).filter((b) => b.days > 0);

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
          <span class="gantt-total-label">${num(scenario.totalDays,1)} total days</span>
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
}

function renderSpiderChart(scenarios) {
  const container = document.getElementById("comparisonRadar");
  if (!container) return;

  const ceiling = Math.max(...scenarios.map((s) => s.totalCost)) * 1.5;
  const sorted = [...scenarios].sort((a, b) => a.totalCost - b.totalCost);

  const rows = sorted.map((scenario, index) => {
    const arch = scenarioArchKey(scenario.name);
    const archLabel = arch === "ac" ? "AC" : arch === "cl2" ? "CL2" : "CL4";
    const pct = (scenario.totalCost / ceiling) * 100;
    const cheapestBadge = index === 0 ? `<span class="cost-best">Lowest</span>` : "";
    return `
      <article class="cost-row" data-arch="${arch}">
        <div class="cost-row-head">
          <p class="cost-row-name">${archLabel} ${cheapestBadge}</p>
          <p class="cost-row-value">${money(scenario.totalCost)}</p>
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
}

function generateOutput() {
  hasGenerated = true;
  revealOutputs();
  runModel();
  document.getElementById("outputArea").scrollIntoView({ behavior: "smooth", block: "start" });
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

function captureExportData(scenarios, inputs) {
  lastScenarios = scenarios;
  lastInputs = inputs;
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

function exportPDF() {
  if (!lastScenarios || !lastInputs) { alert("Generate a comparison first."); return; }
  if (typeof window.jspdf === "undefined") { alert("PDF library not loaded. Check internet connection."); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const meta = getExportMeta();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  // ─── Title Page ───────────────────────────────────────
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text(meta.projectName, pageW / 2, y + 25, { align: "center" });

  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.text("Power Architecture Cost & Time Analysis", pageW / 2, y + 35, { align: "center" });

  y += 50;
  doc.setFontSize(10);
  if (meta.customerName) { doc.text(`Customer: ${meta.customerName}`, margin, y); y += 6; }
  if (meta.preparedBy) { doc.text(`Prepared By: ${meta.preparedBy}`, margin, y); y += 6; }
  doc.text(`Date: ${meta.date}`, margin, y); y += 6;
  doc.text(`Tool Version: Power Delivery Comparison Tool v2.0`, margin, y); y += 12;

  // ─── Project Parameters ───────────────────────────────
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Project Parameters", margin, y); y += 7;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");

  const params = [
    ["Power Required", `${lastInputs.powerW} W`],
    ["Distance", `${lastInputs.distanceFt} ft`],
    ["Crew Size", `${lastInputs.crewSize} persons`],
    ["Installation Type", lastInputs.installationType],
    ["In-Building Routing", lastInputs.inBuildingType || "N/A"],
    ["Outdoor Routing", lastInputs.outdoorType || "N/A"],
    ["AC Conduit Size (outdoor)", lastInputs.outdoorConduitSize || "2\""],
    ["End Device", lastInputs.endDeviceType],
  ];

  doc.autoTable({
    startY: y,
    head: [["Parameter", "Value"]],
    body: params,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
    margin: { left: margin, right: margin },
    tableWidth: 100,
  });
  y = doc.lastAutoTable.finalY + 8;

  // ─── Labor Rates ──────────────────────────────────────
  const labor = getLaborRates();
  const rateRows = [
    ["Electrician", `$${labor.electrician.toFixed(2)}/hr`],
    ["Low Voltage Technician", `$${labor.lvTech.toFixed(2)}/hr`],
    ["Design / PM", `$${labor.design.toFixed(2)}/hr`],
    ["Electrical Designer", `$${labor.designer.toFixed(2)}/hr`],
    ["Construction Laborer", `$${labor.laborer.toFixed(2)}/hr`],
  ];

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Labor Rates", margin, y); y += 7;

  doc.autoTable({
    startY: y,
    head: [["Role", "Rate"]],
    body: rateRows,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
    margin: { left: margin, right: margin },
    tableWidth: 100,
  });
  y = doc.lastAutoTable.finalY + 8;

  // ─── Assumptions ──────────────────────────────────────
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Model Assumptions", margin, y); y += 7;
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");

  getAssumptions().forEach((a, i) => {
    if (y > 250) { doc.addPage(); y = margin; }
    doc.text(`${i + 1}. ${a}`, margin + 2, y);
    y += 5;
  });
  y += 6;

  // ─── Executive Summary ────────────────────────────────
  if (y > 220) { doc.addPage(); y = margin; }
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Executive Summary", margin, y); y += 8;

  const summaryRows = lastScenarios.map((s) => [
    s.name,
    `$${s.totalCost.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
    `$${s.materialTotal.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
    `$${s.laborTotal.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
    `${s.totalHours.toFixed(1)} hrs`,
    `${s.totalDays.toFixed(1)} days`,
    s.fitText,
  ]);

  doc.autoTable({
    startY: y,
    head: [["Architecture", "Total Cost", "Materials", "Labor", "Hours", "Duration", "Fit Assessment"]],
    body: summaryRows,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
    margin: { left: margin, right: margin },
  });
  y = doc.lastAutoTable.finalY + 10;

  // ─── Detailed Line Items per Architecture ─────────────
  lastScenarios.forEach((scenario) => {
    doc.addPage();
    y = margin;
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(`${scenario.name} — Detailed Line Items`, margin, y); y += 4;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(
      `Total: $${scenario.totalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })} | ${scenario.totalDays.toFixed(1)} days | ${scenario.totalHours.toFixed(1)} labor hours`,
      margin, y + 4
    );
    y += 10;

    const lineRows = scenario.rows.map((r) => [
      r.phase.replace(/^\d+\)\s*/, ""),
      r.activity,
      `${r.quantity.toFixed(1)} ${r.unit}`,
      r.laborRole,
      `${r.laborHours.toFixed(1)} hrs`,
      `$${r.materialCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      `$${r.laborCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      `$${r.lineTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    ]);

    doc.autoTable({
      startY: y,
      head: [["Phase", "Activity", "Qty", "Role", "Hours", "Material $", "Labor $", "Total $"]],
      body: lineRows,
      theme: "striped",
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [15, 118, 110], textColor: 255, fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 38 },
        2: { cellWidth: 18 },
        3: { cellWidth: 30 },
        4: { cellWidth: 16 },
        5: { cellWidth: 18 },
        6: { cellWidth: 18 },
        7: { cellWidth: 18 },
      },
      margin: { left: margin, right: margin },
      didDrawPage: () => { y = margin; },
    });
  });

  // ─── Phase Cost Comparison Table ──────────────────────
  doc.addPage();
  y = margin;
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Phase Cost Comparison", margin, y); y += 8;

  const phaseOrder = [...new Set(lastScenarios.flatMap((s) => s.rows.map((r) => r.phase)))];
  const phaseCompRows = phaseOrder.map((phase) => {
    const row = [phase];
    lastScenarios.forEach((s) => {
      const phaseCost = s.rows.filter((r) => r.phase === phase).reduce((sum, r) => sum + r.lineTotal, 0);
      row.push(`$${phaseCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
    });
    return row;
  });

  const phaseCompHead = ["Phase", ...lastScenarios.map((s) => s.name)];

  doc.autoTable({
    startY: y,
    head: [phaseCompHead],
    body: phaseCompRows,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
    margin: { left: margin, right: margin },
  });

  // Save
  const filename = meta.projectName.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_") + "_Report.pdf";
  doc.save(filename);
}

function exportExcel() {
  if (!lastScenarios || !lastInputs) { alert("Generate a comparison first."); return; }
  if (typeof XLSX === "undefined") { alert("Excel library not loaded. Check internet connection."); return; }

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
    summaryData.push([s.name, s.totalCost, s.materialTotal, s.laborTotal, s.totalHours, s.totalDays, s.fitText]);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  ws1["!cols"] = [{ wch: 25 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Summary");

  // ─── Sheet per architecture ───────────────────────────
  lastScenarios.forEach((scenario) => {
    const data = [
      [`${scenario.name} — Line Item Detail`],
      [`Total Cost: $${scenario.totalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`],
      [`Duration: ${scenario.totalDays.toFixed(1)} calendar days (${scenario.totalHours.toFixed(1)} labor hours)`],
      [],
      ["Phase", "Activity", "Description", "Quantity", "Unit", "Labor Role", "Labor Hours", "Labor Rate ($/hr)", "Material Cost ($)", "Labor Cost ($)", "Line Total ($)", "Milestone"],
    ];

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
      row.push(s.rows.filter((r) => r.phase === phase).reduce((sum, r) => sum + r.lineTotal, 0));
    });
    lastScenarios.forEach((s) => {
      const phaseRows = s.rows.filter((r) => r.phase === phase);
      const hrs = phaseRows.reduce((sum, r) => sum + r.laborHours, 0);
      const days = DESIGN_PHASES.has(phase) ? hrs / 8 : hrs / 8 / s.crewSize;
      row.push(parseFloat(days.toFixed(1)));
    });
    compData.push(row);
  });

  // Totals row
  const totalRow = ["TOTAL"];
  lastScenarios.forEach((s) => totalRow.push(s.totalCost));
  lastScenarios.forEach((s) => totalRow.push(parseFloat(s.totalDays.toFixed(1))));
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
}

document.getElementById("modeSingle").addEventListener("click", () => setMode("single"));
document.getElementById("modeMulti").addEventListener("click", () => setMode("multi"));

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
      <label>
        In-Building Routing
        <select class="loc-indoor-routing">
          <option value="idf"${loc.inBuildingType === "idf" ? " selected" : ""}>Open Riser</option>
          <option value="plenum"${loc.inBuildingType === "plenum" ? " selected" : ""}>Plenum Space</option>
          <option value="open-tray"${loc.inBuildingType === "open-tray" ? " selected" : ""}>Open Cable Tray</option>
          <option value="j-hooks"${loc.inBuildingType === "j-hooks" ? " selected" : ""}>J-Hooks on Beam</option>
          <option value="surface"${loc.inBuildingType === "surface" ? " selected" : ""}>Surface Mount</option>
        </select>
      </label>
      <label>
        Outdoor Routing
        <select class="loc-outdoor-routing">
          <option value="direct-bury"${loc.outdoorType === "direct-bury" ? " selected" : ""}>Direct Bury</option>
          <option value="conduit-bury"${loc.outdoorType === "conduit-bury" ? " selected" : ""}>Conduit Buried</option>
          <option value="aerial"${loc.outdoorType === "aerial" ? " selected" : ""}>Aerial/Pole-Mount</option>
          <option value="wall-mount"${loc.outdoorType === "wall-mount" ? " selected" : ""}>Wall Mount</option>
          <option value="underground-duct"${loc.outdoorType === "underground-duct" ? " selected" : ""}>Underground Duct</option>
        </select>
      </label>
      <label>
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

  return card;
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
  const archTotals = { "Class 1 AC": { cost: 0, days: 0 }, "Class 2 DC": { cost: 0, days: 0 }, "Class 4 Fault Managed Power": { cost: 0, days: 0 } };
  perLocation.forEach(({ scenarios }) => {
    scenarios.forEach((s) => {
      if (archTotals[s.name]) {
        archTotals[s.name].cost += s.totalCost;
        archTotals[s.name].days += s.totalDays;
      }
    });
  });

  renderMultiSummary(perLocation, archTotals, crewSize);
  renderMultiBreakdown(perLocation);

  document.getElementById("multiOutputArea").classList.remove("output-hidden");
  document.getElementById("multiOutputArea").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderMultiSummary(perLocation, archTotals, crewSize) {
  const totalLocations = perLocation.length;
  const totalPowerW = perLocation.reduce((s, p) => s + p.loc.powerW, 0);

  const archEntries = Object.entries(archTotals).sort((a, b) => a[1].cost - b[1].cost);
  const lowestCost = archEntries[0][1].cost;

  const archCards = archEntries.map(([name, data]) => {
    const arch = scenarioArchKey(name);
    const isCheapest = data.cost === lowestCost;
    const cheapClass = isCheapest ? " cheapest" : "";
    const badge = isCheapest ? `<div class="snap-badges"><span class="snap-badge good">Lowest Total</span></div>` : "";
    return `
      <article class="metric scenario-metric${cheapClass}" data-arch="${arch}">
        <p class="scenario-metric-name">${name}</p>
        <h3>${money(data.cost)}</h3>
        <p>${num(data.days, 1)} total calendar days</p>
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
  const maxDays = Math.max(...scenarios.map((s) => s.totalDays));

  const trackHtml = scenarios.map((scenario) => {
    const trackBars = phaseOrder.map((phase, pi) => {
      const phaseRows = scenario.rows.filter((r) => r.phase === phase);
      const rawHours = phaseRows.reduce((sum, r) => sum + r.laborHours, 0);
      const days = DESIGN_PHASES.has(phase) ? rawHours / 8 : rawHours / 8 / scenario.crewSize;
      const pct = maxDays > 0 ? (days / maxDays) * 100 : 0;
      const short = PHASE_NAMES_SHORT[phase] || phase;
      const colorClass = GANTT_COLORS[pi % GANTT_COLORS.length];
      return { short, days, pct, colorClass, phase };
    }).filter((b) => b.days > 0);

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
          <span class="gantt-total-label">${num(scenario.totalDays,1)} days</span>
        </div>
        <div class="gantt-track">${barHtml}</div>
      </div>
    `;
  }).join("");

  return `<div class="gantt-wrap gantt-mini-wrap">${trackHtml}</div>`;
}

function renderMultiBreakdown(perLocation) {
  const html = perLocation.map(({ loc, scenarios }) => {
    const sorted = [...scenarios].sort((a, b) => a.totalCost - b.totalCost);
    const pills = sorted.map((s) => {
      const arch = scenarioArchKey(s.name);
      const label = arch === "ac" ? "CL1 AC" : arch === "cl2" ? "CL2 DC" : "CL4 FMP";
      return `
        <div class="loc-arch-pill" data-arch="${arch}">
          <div class="pill-label">${label}</div>
          <div class="pill-cost">${money(s.totalCost)}</div>
          <div class="pill-days">${num(s.totalDays, 1)} days</div>
        </div>
      `;
    }).join("");

    const ganttHtml = renderMultiGantt(scenarios);

    return `
      <div class="loc-breakdown-card">
        <h4>${loc.name}</h4>
        <div class="loc-meta">
          <span>${loc.powerW} W</span>
          <span>${loc.distanceFt} ft</span>
          <span>${loc.installationType}</span>
        </div>
        <div class="loc-arch-pills">${pills}</div>
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

// Initialize with 2 default locations
addLocation();
addLocation();

document.getElementById("addLocationBtn").addEventListener("click", addLocation);
document.getElementById("calculateMultiBtn").addEventListener("click", runMultiModel);

// ─── Single-Location Event Listeners ──────────────────────────────────────────
document.getElementById("calculateBtn").addEventListener("click", generateOutput);
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
document.getElementById("exportPdfBtn").addEventListener("click", exportPDF);
document.getElementById("exportExcelBtn").addEventListener("click", exportExcel);
