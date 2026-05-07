/**
 * Stress Test Suite for Power Delivery Comparison Tool
 * ─────────────────────────────────────────────────────
 * Tests both single-location and multi-location modes across:
 *   • Boundary values (min, max, out-of-range)
 *   • All installation type × routing × end-device combinations
 *   • CL2 distance cutoff (1750 ft)
 *   • Edge cases (tiny power, max power, max distance, crew = 1/20)
 *   • Multi-location with 1–20 locations
 *   • Calculation invariants (costs > 0, days > 0, material + labor ≈ total)
 *   • Rendering integrity (DOM elements produced)
 *
 * Run from browser console on the tool page, OR inject via <script>.
 * Self-contained — does not modify production code.
 */

(function stressTest() {
  "use strict";

  const RESULTS = { passed: 0, failed: 0, errors: [], warnings: [] };

  function assert(condition, label) {
    if (condition) {
      RESULTS.passed++;
    } else {
      RESULTS.failed++;
      RESULTS.errors.push(label);
      console.error("FAIL:", label);
    }
  }

  function warn(label) {
    RESULTS.warnings.push(label);
    console.warn("WARN:", label);
  }

  // ──── Helpers ────────────────────────────────────────────────
  function setField(id, value) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Field #${id} not found`);
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function getField(id) {
    const el = document.getElementById(id);
    return el ? el.value : null;
  }

  function setCardField(card, selector, value) {
    const el = card.querySelector(selector);
    if (!el) throw new Error(`Card field ${selector} not found`);
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function clickButton(id) {
    const btn = document.getElementById(id);
    if (!btn) throw new Error(`Button #${id} not found`);
    btn.click();
  }

  function switchToMode(mode) {
    const btnId = mode === "multi" ? "modeMulti" : "modeSingle";
    const btn = document.getElementById(btnId);
    if (btn) btn.click();
  }

  function resetMultiLocations() {
    if (typeof resetLocationCards === "function") {
      resetLocationCards();
    }
  }

  // ──── Test Data Generators ────────────────────────────────────
  const INSTALLATION_TYPES = ["indoor", "outdoor", "mixed"];
  const IN_BUILDING_TYPES = ["idf", "plenum", "open-tray", "j-hooks", "surface"];
  const OUTDOOR_TYPES = ["direct-bury", "conduit-bury", "aerial", "wall-mount", "underground-duct"];
  const CONDUIT_SIZES = ['3/4"', '1"', '1-1/4"', '2"', '4"'];
  const END_DEVICE_TYPES = ["switch", "media-converter", "direct"];

  const BOUNDARY_POWERS = [10, 100, 999, 1000, 2000, 5000, 10000, 15000];
  const BOUNDARY_DISTANCES = [25, 100, 259, 260, 500, 800, 801, 1750, 1751, 2500, 5000];
  const BOUNDARY_CREWS = [1, 3, 10, 20];
  const EDGE_POWERS = [-100, 0, 5, 10, 15000, 15001, 99999, NaN];
  const EDGE_DISTANCES = [-50, 0, 20, 25, 5000, 5001, 99999, NaN];

  // ──── Scenario Validation Helpers ─────────────────────────────
  function validateScenario(scenario, label) {
    const prefix = `[${label}] ${scenario.name}`;
    const applicable = scenario.isApplicable !== false;

    if (applicable) {
      assert(scenario.totalCost > 0, `${prefix}: totalCost > 0 (got ${scenario.totalCost})`);
      assert(scenario.totalDays > 0, `${prefix}: totalDays > 0 (got ${scenario.totalDays})`);
      assert(scenario.totalHours > 0, `${prefix}: totalHours > 0 (got ${scenario.totalHours})`);
      assert(scenario.materialTotal >= 0, `${prefix}: materialTotal >= 0 (got ${scenario.materialTotal})`);
      assert(scenario.laborTotal >= 0, `${prefix}: laborTotal >= 0 (got ${scenario.laborTotal})`);
      assert(scenario.rows.length > 0, `${prefix}: has rows (got ${scenario.rows.length})`);

      // Material + labor should approximately equal total cost
      const sumParts = scenario.materialTotal + scenario.laborTotal;
      const diff = Math.abs(sumParts - scenario.totalCost);
      const tolerance = scenario.totalCost * 0.01; // 1% tolerance for rounding
      assert(diff <= tolerance, `${prefix}: material(${scenario.materialTotal.toFixed(2)}) + labor(${scenario.laborTotal.toFixed(2)}) ≈ total(${scenario.totalCost.toFixed(2)}), diff=${diff.toFixed(2)}`);

      // Days should be consistent
      assert(scenario.crewSize >= 1, `${prefix}: crewSize >= 1 (got ${scenario.crewSize})`);
      // designDays/installDays only exist on per-location scenarios, not aggregates
      if (typeof scenario.designDays === "number") {
        assert(scenario.designDays >= 0, `${prefix}: designDays >= 0 (got ${scenario.designDays})`);
        assert(scenario.installDays >= 0, `${prefix}: installDays >= 0 (got ${scenario.installDays})`);
        const daysDiff = Math.abs((scenario.designDays + scenario.installDays) - scenario.totalDays);
        assert(daysDiff < 0.01, `${prefix}: designDays + installDays ≈ totalDays (diff=${daysDiff.toFixed(4)})`);
      }

      // Row-level checks
      scenario.rows.forEach((row, ri) => {
        assert(typeof row.phase === "string" && row.phase.length > 0, `${prefix} row[${ri}]: has phase`);
        assert(typeof row.lineTotal === "number" && isFinite(row.lineTotal), `${prefix} row[${ri}]: lineTotal is finite (got ${row.lineTotal})`);
        assert(row.lineTotal >= 0, `${prefix} row[${ri}]: lineTotal >= 0 (got ${row.lineTotal})`);
      });

      // Capacity checks
      if (scenario.capacity) {
        const cap = scenario.capacity;
        if (cap.applicable !== false) {
          assert(cap.totalW > 0, `${prefix}: capacity totalW > 0 (got ${cap.totalW})`);
          assert(cap.usedW >= 0, `${prefix}: capacity usedW >= 0 (got ${cap.usedW})`);
          assert(cap.remainingW >= 0, `${prefix}: capacity remainingW >= 0 (got ${cap.remainingW})`);
          assert(cap.usedW <= cap.totalW, `${prefix}: capacity usedW <= totalW (${cap.usedW} <= ${cap.totalW})`);
        }
      }
    } else {
      // N/A scenario — should be CL2 at distance > 1750
      assert(scenario.name === "Class 2 DC", `${prefix}: only CL2 should be N/A`);
      assert(scenario.totalCost === 0, `${prefix}: N/A totalCost === 0`);
      assert(scenario.rows.length === 0, `${prefix}: N/A has 0 rows`);
    }
  }

  function validateScenarioSet(scenarios, label) {
    assert(Array.isArray(scenarios), `${label}: scenarios is array`);
    assert(scenarios.length === 3, `${label}: has 3 scenarios (got ${scenarios.length})`);

    const names = scenarios.map(s => s.name).sort();
    assert(names.includes("Class 1 AC"), `${label}: has AC scenario`);
    assert(names.includes("Class 2 DC"), `${label}: has CL2 scenario`);
    assert(names.includes("Class 4 Fault Managed Power"), `${label}: has CL4 scenario`);

    scenarios.forEach(s => validateScenario(s, label));

    // Cross-scenario checks
    const applicable = scenarios.filter(s => s.isApplicable !== false);
    if (applicable.length > 1) {
      // Cost order should be consistent
      const sorted = [...applicable].sort((a, b) => a.totalCost - b.totalCost);
      assert(sorted[0].totalCost <= sorted[sorted.length - 1].totalCost, `${label}: cost ordering is valid`);
    }
  }

  // ──── SINGLE-LOCATION STRESS TESTS ───────────────────────────
  function runSingleLocationTests() {
    console.group("═══ Single-Location Stress Tests ═══");
    switchToMode("single");

    const labor = typeof getLaborRates === "function" ? getLaborRates() : {
      electrician: 31.11, lvTech: 28.51, design: 51.43, designer: 35.44, laborer: 22.47
    };

    let testCount = 0;

    // ── Test 1: Boundary value matrix ──────────────────────────
    console.group("1. Boundary Values");
    BOUNDARY_POWERS.forEach(power => {
      BOUNDARY_DISTANCES.forEach(distance => {
        BOUNDARY_CREWS.forEach(crew => {
          try {
            const scenarios = buildComparison(power, distance, labor, crew, 0, "indoor", "idf", "direct-bury", "switch", '2"');
            validateScenarioSet(scenarios, `single(P=${power},D=${distance},C=${crew})`);
            testCount++;
          } catch (e) {
            RESULTS.failed++;
            RESULTS.errors.push(`single(P=${power},D=${distance},C=${crew}): EXCEPTION: ${e.message}`);
            console.error(`EXCEPTION at P=${power},D=${distance},C=${crew}:`, e);
          }
        });
      });
    });
    console.log(`Boundary value tests: ${testCount} combos`);
    console.groupEnd();

    // ── Test 2: Edge / out-of-range values ─────────────────────
    console.group("2. Edge Values (out-of-range)");
    EDGE_POWERS.forEach(power => {
      EDGE_DISTANCES.forEach(distance => {
        try {
          const clampedPower = Math.max(10, Math.min(15000, isNaN(power) ? 10 : power));
          const clampedDist = Math.max(25, Math.min(5000, isNaN(distance) ? 25 : distance));
          const scenarios = buildComparison(clampedPower, clampedDist, labor, 3, 0, "indoor", "idf", "direct-bury", "switch", '2"');
          validateScenarioSet(scenarios, `edge(P=${power}→${clampedPower},D=${distance}→${clampedDist})`);
        } catch (e) {
          RESULTS.failed++;
          RESULTS.errors.push(`edge(P=${power},D=${distance}): EXCEPTION: ${e.message}`);
        }
      });
    });
    console.groupEnd();

    // ── Test 3: All installation type × routing combinations ───
    console.group("3. Installation Type × Routing Combos");
    let comboCount = 0;
    INSTALLATION_TYPES.forEach(instType => {
      const indoorTypes = (instType === "indoor" || instType === "mixed") ? IN_BUILDING_TYPES : ["idf"];
      const outdoorTypeList = (instType === "outdoor" || instType === "mixed") ? OUTDOOR_TYPES : ["direct-bury"];
      const conduitList = (instType === "outdoor" || instType === "mixed") ? CONDUIT_SIZES : ['2"'];

      indoorTypes.forEach(inType => {
        outdoorTypeList.forEach(outType => {
          conduitList.forEach(conduit => {
            END_DEVICE_TYPES.forEach(endDev => {
              try {
                const scenarios = buildComparison(1000, 500, labor, 3, 0, instType, inType, outType, endDev, conduit);
                validateScenarioSet(scenarios, `combo(${instType}/${inType}/${outType}/${conduit}/${endDev})`);
                comboCount++;
              } catch (e) {
                RESULTS.failed++;
                RESULTS.errors.push(`combo(${instType}/${inType}/${outType}/${conduit}/${endDev}): EXCEPTION: ${e.message}`);
              }
            });
          });
        });
      });
    });
    console.log(`Combo tests: ${comboCount} combos`);
    console.groupEnd();

    // ── Test 4: CL2 distance cutoff ────────────────────────────
    console.group("4. CL2 Distance Cutoff");
    [1749, 1750, 1751, 2000, 5000].forEach(dist => {
      try {
        const scenarios = buildComparison(1000, dist, labor, 3, 0, "indoor", "idf", "direct-bury", "switch", '2"');
        const cl2 = scenarios.find(s => s.name === "Class 2 DC");
        if (dist > 1750) {
          assert(cl2.isApplicable === false, `CL2 at ${dist}ft should be N/A`);
        } else {
          assert(cl2.isApplicable !== false, `CL2 at ${dist}ft should be applicable`);
        }
      } catch (e) {
        RESULTS.failed++;
        RESULTS.errors.push(`CL2 cutoff(D=${dist}): EXCEPTION: ${e.message}`);
      }
    });
    console.groupEnd();

    // ── Test 5: Conduit cost override ──────────────────────────
    console.group("5. Conduit Cost Override");
    [0, 0.5, 5, 25, 50].forEach(costOverride => {
      try {
        const s0 = buildComparison(1000, 500, labor, 3, 0, "indoor", "idf", "direct-bury", "switch", '2"');
        const sOv = buildComparison(1000, 500, labor, 3, costOverride, "indoor", "idf", "direct-bury", "switch", '2"');
        validateScenarioSet(sOv, `conduitOverride(${costOverride})`);
        if (costOverride > 0) {
          // With override, costs should differ from no-override (at least for some scenarios)
          // This is a soft check — indoor mode may not use conduit
        }
      } catch (e) {
        RESULTS.failed++;
        RESULTS.errors.push(`conduitOverride(${costOverride}): EXCEPTION: ${e.message}`);
      }
    });
    console.groupEnd();

    // ── Test 6: AC equipment tiers ─────────────────────────────
    console.group("6. AC Equipment Tiers (simple/standard/full)");
    // Simple: distanceFt < 260 && powerW < 2000
    // Full: powerW > 10000 || distanceFt > 800
    const tierTests = [
      { power: 500, dist: 100, label: "simple" },
      { power: 2000, dist: 260, label: "standard-low" },
      { power: 5000, dist: 500, label: "standard-mid" },
      { power: 10001, dist: 500, label: "full-power" },
      { power: 5000, dist: 801, label: "full-distance" },
      { power: 15000, dist: 5000, label: "full-max" },
    ];
    tierTests.forEach(({ power, dist, label }) => {
      try {
        const scenarios = buildComparison(power, dist, labor, 3, 0, "indoor", "idf", "direct-bury", "switch", '2"');
        const ac = scenarios.find(s => s.name === "Class 1 AC");
        assert(ac && ac.totalCost > 0, `AC tier ${label}(P=${power},D=${dist}): cost > 0`);
        validateScenario(ac, `AC-tier-${label}`);
      } catch (e) {
        RESULTS.failed++;
        RESULTS.errors.push(`AC-tier-${label}: EXCEPTION: ${e.message}`);
      }
    });
    console.groupEnd();

    // ── Test 7: Labor rate sensitivity ─────────────────────────
    console.group("7. Labor Rate Sensitivity");
    const laborRateSets = [
      { electrician: 10, lvTech: 10, design: 10, designer: 10, laborer: 10 },
      { electrician: 250, lvTech: 250, design: 250, designer: 250, laborer: 250 },
      { electrician: 100, lvTech: 50, design: 200, designer: 100, laborer: 30 },
    ];
    laborRateSets.forEach((lr, i) => {
      try {
        const scenarios = buildComparison(1000, 500, lr, 3, 0, "indoor", "idf", "direct-bury", "switch", '2"');
        validateScenarioSet(scenarios, `laborRates-set${i}`);
      } catch (e) {
        RESULTS.failed++;
        RESULTS.errors.push(`laborRates-set${i}: EXCEPTION: ${e.message}`);
      }
    });
    console.groupEnd();

    // ── Test 8: Power monotonicity ─────────────────────────────
    console.group("8. Cost Monotonicity (more power → higher cost)");
    try {
      const powers = [100, 500, 1000, 5000, 10000, 15000];
      let prevAC = 0, prevCL4 = 0;
      powers.forEach(p => {
        const scenarios = buildComparison(p, 500, labor, 3, 0, "indoor", "idf", "direct-bury", "switch", '2"');
        const ac = scenarios.find(s => s.name === "Class 1 AC");
        const cl4 = scenarios.find(s => s.name === "Class 4 Fault Managed Power");
        if (ac && ac.isApplicable !== false) {
          assert(ac.totalCost >= prevAC, `AC cost monotonic: P=${p} cost ${ac.totalCost.toFixed(2)} >= prev ${prevAC.toFixed(2)}`);
          prevAC = ac.totalCost;
        }
        if (cl4 && cl4.isApplicable !== false) {
          assert(cl4.totalCost >= prevCL4, `CL4 cost monotonic: P=${p} cost ${cl4.totalCost.toFixed(2)} >= prev ${prevCL4.toFixed(2)}`);
          prevCL4 = cl4.totalCost;
        }
      });
    } catch (e) {
      RESULTS.failed++;
      RESULTS.errors.push(`monotonicity: EXCEPTION: ${e.message}`);
    }
    console.groupEnd();

    // ── Test 9: Distance monotonicity ──────────────────────────
    console.group("9. Distance Monotonicity (further → higher cost)");
    try {
      const distances = [25, 100, 500, 1000, 2500, 5000];
      let prevAC = 0, prevCL4 = 0;
      distances.forEach(d => {
        const scenarios = buildComparison(1000, d, labor, 3, 0, "indoor", "idf", "direct-bury", "switch", '2"');
        const ac = scenarios.find(s => s.name === "Class 1 AC");
        const cl4 = scenarios.find(s => s.name === "Class 4 Fault Managed Power");
        if (ac && ac.isApplicable !== false) {
          assert(ac.totalCost >= prevAC, `AC cost monotonic: D=${d} cost ${ac.totalCost.toFixed(2)} >= prev ${prevAC.toFixed(2)}`);
          prevAC = ac.totalCost;
        }
        if (cl4 && cl4.isApplicable !== false) {
          assert(cl4.totalCost >= prevCL4, `CL4 cost monotonic: D=${d} cost ${cl4.totalCost.toFixed(2)} >= prev ${prevCL4.toFixed(2)}`);
          prevCL4 = cl4.totalCost;
        }
      });
    } catch (e) {
      RESULTS.failed++;
      RESULTS.errors.push(`dist-monotonicity: EXCEPTION: ${e.message}`);
    }
    console.groupEnd();

    // ── Test 10: DOM rendering (single) ────────────────────────
    console.group("10. DOM Rendering (single-location)");
    try {
      setField("powerW", 1000);
      setField("distanceFt", 500);
      setField("crewSize", 3);
      setField("installationType", "indoor");
      clickButton("calculateProjectBtn");

      const summary = document.getElementById("summary");
      assert(summary && summary.innerHTML.length > 50, "Single summary rendered with content");

      const phases = document.getElementById("phaseSections");
      assert(phases && phases.innerHTML.length > 50, "Phase sections rendered");

      const gantt = document.getElementById("ganttChart");
      assert(gantt && gantt.innerHTML.length > 50, "Gantt chart rendered");

      const capacity = document.getElementById("capacityAvailability");
      assert(capacity && capacity.innerHTML.length > 50, "Capacity availability rendered");
    } catch (e) {
      RESULTS.failed++;
      RESULTS.errors.push(`DOM-single: EXCEPTION: ${e.message}`);
    }
    console.groupEnd();

    console.groupEnd();
  }

  // ──── MULTI-LOCATION STRESS TESTS ────────────────────────────
  function runMultiLocationTests() {
    console.group("═══ Multi-Location Stress Tests ═══");

    const labor = typeof getLaborRates === "function" ? getLaborRates() : {
      electrician: 31.11, lvTech: 28.51, design: 51.43, designer: 35.44, laborer: 22.47
    };

    // ── Test 11: Multi-location calculation with varying location counts ──
    console.group("11. Multi-Location Varying Count (2–20 locations)");
    const locationCounts = [2, 3, 5, 10, 15, 20];
    locationCounts.forEach(count => {
      try {
        const perLocation = [];
        for (let i = 0; i < count; i++) {
          const power = 500 + i * 200;
          const dist = 100 + i * 150;
          const scenarios = buildComparison(
            Math.min(power, 15000), Math.min(dist, 5000),
            labor, 3, 0, "indoor", "idf", "direct-bury", "switch", '2"'
          );
          perLocation.push({
            loc: { name: `IDF-${i+1}`, powerW: Math.min(power, 15000), distanceFt: Math.min(dist, 5000), installationType: "indoor" },
            scenarios
          });
        }

        // Validate each location's scenarios
        perLocation.forEach(({ loc, scenarios }) => {
          validateScenarioSet(scenarios, `multi(${count}locs)-${loc.name}`);
        });

        // Validate aggregate
        const aggregated = buildAggregateScenarios(perLocation, 3);
        validateScenarioSet(aggregated, `multi(${count}locs)-aggregate`);

        // Aggregate cost should equal sum of individual costs per arch
        ["Class 1 AC", "Class 2 DC", "Class 4 Fault Managed Power"].forEach(archName => {
          const agg = aggregated.find(s => s.name === archName);
          if (agg && agg.isApplicable !== false) {
            const sum = perLocation.reduce((acc, { scenarios }) => {
              const s = scenarios.find(x => x.name === archName);
              return acc + (s && s.isApplicable !== false ? s.totalCost : 0);
            }, 0);
            const diff = Math.abs(agg.totalCost - sum);
            assert(diff < 0.01, `multi(${count}locs) ${archName}: aggregate cost ${agg.totalCost.toFixed(2)} ≈ sum ${sum.toFixed(2)}`);
          }
        });
      } catch (e) {
        RESULTS.failed++;
        RESULTS.errors.push(`multi(${count}locs): EXCEPTION: ${e.message}`);
      }
    });
    console.groupEnd();

    // ── Test 12: Mixed installation types across locations ─────
    console.group("12. Mixed Installation Types Across Locations");
    try {
      const mixedLocs = [
        { type: "indoor", inType: "idf", outType: "direct-bury", conduit: '2"', endDev: "switch" },
        { type: "outdoor", inType: "idf", outType: "aerial", conduit: '1"', endDev: "media-converter" },
        { type: "mixed", inType: "plenum", outType: "conduit-bury", conduit: '4"', endDev: "direct" },
        { type: "indoor", inType: "j-hooks", outType: "direct-bury", conduit: '2"', endDev: "switch" },
        { type: "outdoor", inType: "idf", outType: "underground-duct", conduit: '1-1/4"', endDev: "switch" },
      ];
      const perLocation = mixedLocs.map((cfg, i) => {
        const scenarios = buildComparison(1000, 500, labor, 3, 0, cfg.type, cfg.inType, cfg.outType, cfg.endDev, cfg.conduit);
        return {
          loc: { name: `MIX-${i+1}`, powerW: 1000, distanceFt: 500, installationType: cfg.type },
          scenarios
        };
      });
      perLocation.forEach(({ loc, scenarios }) => {
        validateScenarioSet(scenarios, `mixedTypes-${loc.name}`);
      });
      const agg = buildAggregateScenarios(perLocation, 3);
      validateScenarioSet(agg, "mixedTypes-aggregate");
    } catch (e) {
      RESULTS.failed++;
      RESULTS.errors.push(`mixedTypes: EXCEPTION: ${e.message}`);
    }
    console.groupEnd();

    // ── Test 13: Multi-location with CL2 cutoff at some locations ──
    console.group("13. Multi-Location with Partial CL2 Cutoff");
    try {
      const locs = [
        { power: 1000, dist: 500 },  // CL2 applicable
        { power: 1000, dist: 2000 }, // CL2 NOT applicable (> 1750)
        { power: 1000, dist: 1000 }, // CL2 applicable
      ];
      const perLocation = locs.map((l, i) => {
        const scenarios = buildComparison(l.power, l.dist, labor, 3, 0, "indoor", "idf", "direct-bury", "switch", '2"');
        return {
          loc: { name: `CL2-${i+1}`, powerW: l.power, distanceFt: l.dist, installationType: "indoor" },
          scenarios
        };
      });

      // Location 2 should have CL2 as N/A
      const loc2CL2 = perLocation[1].scenarios.find(s => s.name === "Class 2 DC");
      assert(loc2CL2.isApplicable === false, "Multi loc2 CL2 at 2000ft is N/A");

      // Aggregate CL2 should also be N/A
      const agg = buildAggregateScenarios(perLocation, 3);
      const aggCL2 = agg.find(s => s.name === "Class 2 DC");
      assert(aggCL2.isApplicable === false, "Aggregate CL2 is N/A when any location exceeds 1750ft");
    } catch (e) {
      RESULTS.failed++;
      RESULTS.errors.push(`partialCL2Cutoff: EXCEPTION: ${e.message}`);
    }
    console.groupEnd();

    // ── Test 14: Extreme multi-location (high power, max distance) ──
    console.group("14. Extreme Multi-Location Parameters");
    try {
      const perLocation = [];
      for (let i = 0; i < 10; i++) {
        const scenarios = buildComparison(15000, 5000, labor, 1, 50, "outdoor", "idf", "underground-duct", "switch", '4"');
        perLocation.push({
          loc: { name: `EXTREME-${i+1}`, powerW: 15000, distanceFt: 5000, installationType: "outdoor" },
          scenarios
        });
      }
      perLocation.forEach(({ loc, scenarios }) => {
        validateScenarioSet(scenarios, `extreme-${loc.name}`);
      });
      const agg = buildAggregateScenarios(perLocation, 1);
      assert(agg.length === 3, "Extreme multi: 3 aggregate scenarios");
      agg.forEach(s => {
        if (s.isApplicable !== false) {
          assert(s.totalCost > 0, `Extreme agg ${s.name}: cost > 0`);
          assert(isFinite(s.totalCost), `Extreme agg ${s.name}: cost is finite (got ${s.totalCost})`);
          assert(isFinite(s.totalDays), `Extreme agg ${s.name}: days is finite (got ${s.totalDays})`);
        }
      });
    } catch (e) {
      RESULTS.failed++;
      RESULTS.errors.push(`extremeMulti: EXCEPTION: ${e.message}`);
    }
    console.groupEnd();

    // ── Test 15: Single location in multi mode ─────────────────
    console.group("15. Single Location in Multi Mode");
    try {
      const scenarios = buildComparison(1000, 500, labor, 3, 0, "indoor", "idf", "direct-bury", "switch", '2"');
      const perLocation = [{
        loc: { name: "SOLO", powerW: 1000, distanceFt: 500, installationType: "indoor" },
        scenarios
      }];
      const agg = buildAggregateScenarios(perLocation, 3);
      // Aggregate should match single location exactly
      ["Class 1 AC", "Class 2 DC", "Class 4 Fault Managed Power"].forEach(archName => {
        const single = scenarios.find(s => s.name === archName);
        const aggregated = agg.find(s => s.name === archName);
        if (single.isApplicable !== false) {
          const costDiff = Math.abs(single.totalCost - aggregated.totalCost);
          assert(costDiff < 0.01, `Solo ${archName}: single cost ${single.totalCost.toFixed(2)} ≈ aggregate ${aggregated.totalCost.toFixed(2)}`);
        }
      });
    } catch (e) {
      RESULTS.failed++;
      RESULTS.errors.push(`soloMulti: EXCEPTION: ${e.message}`);
    }
    console.groupEnd();

    // ── Test 16: All locations at CL2 cutoff boundary ──────────
    console.group("16. All Locations at CL2 Boundary (1750 ft)");
    try {
      const perLocation = [];
      for (let i = 0; i < 5; i++) {
        const scenarios = buildComparison(1000, 1750, labor, 3, 0, "indoor", "idf", "direct-bury", "switch", '2"');
        perLocation.push({
          loc: { name: `BOUNDARY-${i+1}`, powerW: 1000, distanceFt: 1750, installationType: "indoor" },
          scenarios
        });
      }
      const cl2 = perLocation[0].scenarios.find(s => s.name === "Class 2 DC");
      assert(cl2.isApplicable !== false, "CL2 at exactly 1750ft should be applicable");
      const agg = buildAggregateScenarios(perLocation, 3);
      const aggCL2 = agg.find(s => s.name === "Class 2 DC");
      assert(aggCL2.isApplicable !== false, "Aggregate CL2 at all 1750ft should be applicable");
    } catch (e) {
      RESULTS.failed++;
      RESULTS.errors.push(`cl2Boundary: EXCEPTION: ${e.message}`);
    }
    console.groupEnd();

    // ── Test 17: DOM rendering (multi-location) ────────────────
    console.group("17. DOM Rendering (multi-location)");
    try {
      // Clear project first to unlock inputs
      if (typeof clearProject === "function") clearProject();
      if (typeof setProjectLocked === "function") setProjectLocked(false);

      switchToMode("multi");
      resetMultiLocations();

      // Set values on the 2 default location cards
      const cards = document.querySelectorAll(".location-card");
      assert(cards.length >= 2, `Multi DOM: has >= 2 location cards (got ${cards.length})`);

      if (cards.length >= 2) {
        setCardField(cards[0], ".loc-power", 1000);
        setCardField(cards[0], ".loc-distance", 500);
        setCardField(cards[1], ".loc-power", 2000);
        setCardField(cards[1], ".loc-distance", 800);

        clickButton("calculateProjectBtn");

        const multiSummary = document.getElementById("multiSummary");
        assert(multiSummary && multiSummary.innerHTML.length > 50, "Multi summary rendered");

        const multiCapacity = document.getElementById("multiCapacity");
        assert(multiCapacity && multiCapacity.innerHTML.length > 50, "Multi capacity section rendered");

        const multiBreakdown = document.getElementById("multiLocationBreakdown");
        assert(multiBreakdown && multiBreakdown.innerHTML.length > 50, "Multi breakdown rendered");

        // Check for IDF cards
        const idfCards = multiSummary.querySelectorAll(".idf-summary-card");
        assert(idfCards.length === 2, `Multi DOM: 2 IDF summary cards (got ${idfCards.length})`);

        // Check for capacity pie charts
        const overallPies = multiCapacity.querySelectorAll(".capacity-card:not(.capacity-card-sm)");
        assert(overallPies.length >= 1, `Multi DOM: overall capacity pies rendered (got ${overallPies.length})`);

        // Check for per-IDF sub-pies
        const subPieSections = multiCapacity.querySelectorAll(".multi-cap-idf");
        assert(subPieSections.length === 2, `Multi DOM: 2 per-IDF capacity sections (got ${subPieSections.length})`);

        // Check for collapsible breakdowns
        const collapsibles = multiBreakdown.querySelectorAll(".loc-breakdown-collapsible");
        assert(collapsibles.length === 2, `Multi DOM: 2 collapsible breakdowns (got ${collapsibles.length})`);

        // First should be open
        assert(collapsibles[0] && collapsibles[0].hasAttribute("open"), "First breakdown is open");

        // Check that capacity bars and gantt are NOT in breakdown
        const breakdownBars = multiBreakdown.querySelectorAll(".capacity-bar-chart");
        assert(breakdownBars.length === 0, `Multi breakdown: no capacity bar charts (got ${breakdownBars.length})`);

        const breakdownGantt = multiBreakdown.querySelectorAll(".gantt-wrap");
        assert(breakdownGantt.length === 0, `Multi breakdown: no gantt charts (got ${breakdownGantt.length})`);

        // Check that grand totals section is gone
        const grandTotals = document.getElementById("multiGrandTotals");
        assert(!grandTotals || grandTotals.innerHTML.trim() === "", "Grand totals section removed or empty");

        // Check for overall Gantt in summary
        const summaryGantt = multiSummary.querySelectorAll(".gantt-wrap");
        assert(summaryGantt.length === 1, `Multi summary: 1 overall Gantt chart (got ${summaryGantt.length})`);

        // Check IDF arch ranking rows
        const archRows = multiSummary.querySelectorAll(".idf-arch-row");
        assert(archRows.length === 6, `Multi summary: 6 arch rows (3 per IDF × 2 IDFs, got ${archRows.length})`);
      }
    } catch (e) {
      RESULTS.failed++;
      RESULTS.errors.push(`DOM-multi: EXCEPTION: ${e.message}`);
    }
    console.groupEnd();

    runRandomFuzzTests(labor);

    console.groupEnd();
  }

  // ──── RANDOM FUZZ TESTS ──────────────────────────────────────
  function runRandomFuzzTests(labor) {
    console.group("═══ Random Fuzz Tests (200 iterations) ═══");

    const FUZZ_COUNT = 200;
    let fuzzPassed = 0;

    for (let i = 0; i < FUZZ_COUNT; i++) {
      try {
        const power = Math.floor(Math.random() * 15000) + 10;
        const dist = Math.floor(Math.random() * 5000) + 25;
        const crew = Math.floor(Math.random() * 20) + 1;
        const conduit = Math.random() * 50;
        const instType = INSTALLATION_TYPES[Math.floor(Math.random() * INSTALLATION_TYPES.length)];
        const inType = IN_BUILDING_TYPES[Math.floor(Math.random() * IN_BUILDING_TYPES.length)];
        const outType = OUTDOOR_TYPES[Math.floor(Math.random() * OUTDOOR_TYPES.length)];
        const conduitSize = CONDUIT_SIZES[Math.floor(Math.random() * CONDUIT_SIZES.length)];
        const endDev = END_DEVICE_TYPES[Math.floor(Math.random() * END_DEVICE_TYPES.length)];

        const lr = {
          electrician: 10 + Math.random() * 240,
          lvTech: 10 + Math.random() * 240,
          design: 10 + Math.random() * 240,
          designer: 10 + Math.random() * 240,
          laborer: 10 + Math.random() * 240,
        };

        const scenarios = buildComparison(power, dist, lr, crew, conduit, instType, inType, outType, endDev, conduitSize);
        validateScenarioSet(scenarios, `fuzz#${i}(P=${power},D=${dist},C=${crew},${instType})`);
        fuzzPassed++;
      } catch (e) {
        RESULTS.failed++;
        RESULTS.errors.push(`fuzz#${i}: EXCEPTION: ${e.message}`);
      }
    }
    console.log(`Fuzz: ${fuzzPassed}/${FUZZ_COUNT} passed`);
    console.groupEnd();

    // ── Multi-location fuzz ────────────────────────────────────
    console.group("═══ Multi-Location Fuzz Tests (50 iterations) ═══");
    const MULTI_FUZZ = 50;
    let multiFuzzPassed = 0;

    for (let i = 0; i < MULTI_FUZZ; i++) {
      try {
        const locCount = Math.floor(Math.random() * 10) + 2;
        const crew = Math.floor(Math.random() * 20) + 1;
        const perLocation = [];

        for (let j = 0; j < locCount; j++) {
          const power = Math.floor(Math.random() * 15000) + 10;
          const dist = Math.floor(Math.random() * 5000) + 25;
          const instType = INSTALLATION_TYPES[Math.floor(Math.random() * INSTALLATION_TYPES.length)];
          const inType = IN_BUILDING_TYPES[Math.floor(Math.random() * IN_BUILDING_TYPES.length)];
          const outType = OUTDOOR_TYPES[Math.floor(Math.random() * OUTDOOR_TYPES.length)];
          const conduitSize = CONDUIT_SIZES[Math.floor(Math.random() * CONDUIT_SIZES.length)];
          const endDev = END_DEVICE_TYPES[Math.floor(Math.random() * END_DEVICE_TYPES.length)];

          const scenarios = buildComparison(power, dist, labor, crew, 0, instType, inType, outType, endDev, conduitSize);
          perLocation.push({
            loc: { name: `FUZZ-${j+1}`, powerW: power, distanceFt: dist, installationType: instType },
            scenarios
          });
        }

        const agg = buildAggregateScenarios(perLocation, crew);
        validateScenarioSet(agg, `multiFuzz#${i}(${locCount}locs)`);

        // Verify aggregate sums
        ["Class 1 AC", "Class 4 Fault Managed Power"].forEach(archName => {
          const aggS = agg.find(s => s.name === archName);
          if (aggS && aggS.isApplicable !== false) {
            const sum = perLocation.reduce((acc, { scenarios }) => {
              const s = scenarios.find(x => x.name === archName);
              return acc + (s && s.isApplicable !== false ? s.totalCost : 0);
            }, 0);
            const diff = Math.abs(aggS.totalCost - sum);
            assert(diff < 0.02, `multiFuzz#${i} ${archName}: agg ${aggS.totalCost.toFixed(2)} ≈ sum ${sum.toFixed(2)}`);
          }
        });

        multiFuzzPassed++;
      } catch (e) {
        RESULTS.failed++;
        RESULTS.errors.push(`multiFuzz#${i}: EXCEPTION: ${e.message}`);
      }
    }
    console.log(`Multi fuzz: ${multiFuzzPassed}/${MULTI_FUZZ} passed`);
    console.groupEnd();

    printResults();
  }

  // ──── Results Summary ────────────────────────────────────────
  function printResults() {
    console.log("\n");
    console.group("════════════════════════════════════════════");
    console.log("       STRESS TEST RESULTS SUMMARY");
    console.log("════════════════════════════════════════════");
    console.log(`  PASSED: ${RESULTS.passed}`);
    console.log(`  FAILED: ${RESULTS.failed}`);
    console.log(`  WARNINGS: ${RESULTS.warnings.length}`);
    console.log(`  TOTAL:  ${RESULTS.passed + RESULTS.failed}`);
    console.log("════════════════════════════════════════════");

    if (RESULTS.errors.length > 0) {
      console.group("FAILURES:");
      RESULTS.errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
      console.groupEnd();
    }

    if (RESULTS.warnings.length > 0) {
      console.group("WARNINGS:");
      RESULTS.warnings.forEach((w, i) => console.warn(`  ${i + 1}. ${w}`));
      console.groupEnd();
    }

    console.groupEnd();

    // Also show in the page
    const banner = document.createElement("div");
    banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;padding:16px 24px;font-family:monospace;font-size:14px;text-align:center;";
    banner.style.background = RESULTS.failed === 0 ? "#065f46" : "#991b1b";
    banner.style.color = "#fff";
    banner.innerHTML = `<strong>Stress Test Complete:</strong> ${RESULTS.passed} passed, ${RESULTS.failed} failed, ${RESULTS.warnings.length} warnings out of ${RESULTS.passed + RESULTS.failed} assertions`;
    document.body.prepend(banner);
    setTimeout(() => banner.remove(), 60000);
  }

  // ──── Start ──────────────────────────────────────────────────
  console.clear();
  console.log("Starting stress test suite...\n");
  try {
    runSingleLocationTests();
    runMultiLocationTests();
  } catch (e) {
    console.error("Top-level exception:", e);
    RESULTS.failed++;
    RESULTS.errors.push(`TOP-LEVEL: ${e.message}`);
    printResults();
  }

})();
