# Build_ExcelModel.ps1
# Generates Power_Delivery_Comparison_Model.xlsm — a full-fidelity Excel mirror of app.js
# Includes live formulas (no hard-coded calc values) and three VBA macros.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$outPath = Join-Path $root "Power_Delivery_Comparison_Model.xlsm"
if (Test-Path $outPath) { Remove-Item $outPath -Force }

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.ScreenUpdating = $false

# --- Trust setting check (programmatic VBA write requires Trust access to the VBA project) ---
try {
    $vbomTrust = $excel.AutomationSecurity
} catch {}

$wb = $excel.Workbooks.Add()
# Remove default extra sheets, keep one
while ($wb.Sheets.Count -gt 1) { $wb.Sheets.Item($wb.Sheets.Count).Delete() }

# Helper to add a sheet
function Add-Sheet($name) {
    $s = $wb.Sheets.Add([System.Reflection.Missing]::Value, $wb.Sheets.Item($wb.Sheets.Count))
    $s.Name = $name
    return $s
}

# Rename first sheet
$wb.Sheets.Item(1).Name = "Inputs"

# ──────────────────────────────────────────────────────────────────────────
# SHEET: Inputs
# ──────────────────────────────────────────────────────────────────────────
$ws = $wb.Sheets.Item("Inputs")
$ws.Cells.Item(1,1) = "POWER DELIVERY COMPARISON — INPUTS"
$ws.Range("A1:C1").Merge()
$ws.Range("A1").Font.Bold = $true
$ws.Range("A1").Font.Size = 14
$ws.Range("A1").Interior.Color = 0x0E766E  # teal
$ws.Range("A1").Font.Color = 0xFFFFFF

$inputRows = @(
    @("Section","PROJECT INPUTS","",""),
    @("powerW","Power required",1500,"W"),
    @("distanceFt","Distance (ft)",500,"ft"),
    @("crewSize","Crew size",3,"persons"),
    @("conduitOverride","Conduit override (0 = use lookup)",0,"`$/ft"),
    @("","","",""),
    @("Section","INSTALLATION CONFIG","",""),
    @("installType","Installation type (indoor/outdoor/mixed)","indoor",""),
    @("inBuildingType","In-building routing","idf",""),
    @("outdoorType","Outdoor routing","direct-bury",""),
    @("outdoorConduitSize","AC conduit size (outdoor) — 3/4 / 1 / 1-1/4 / 2 / 4",'2"',"in"),
    @("endDevice","End device (switch/media-converter/direct)","switch",""),
    @("","","",""),
    @("Section","LABOR RATES","",""),
    @("rateElectrician","Electrician",31.11,"`$/hr"),
    @("rateLvTech","LV Technician",28.51,"`$/hr"),
    @("rateDesign","Design / PM",51.43,"`$/hr"),
    @("rateDesigner","Electrical Designer",35.44,"`$/hr"),
    @("rateLaborer","Construction Laborer",22.47,"`$/hr"),
    @("rateWait","Wait time (AHJ) — no labor cost",0,"`$/hr")
)

$row = 3
foreach ($r in $inputRows) {
    $name = $r[0]; $label = $r[1]; $val = $r[2]; $unit = $r[3]
    if ($name -eq "Section") {
        $ws.Cells.Item($row,1) = $label
        $ws.Range("A$row`:D$row").Merge()
        $ws.Range("A$row").Font.Bold = $true
        $ws.Range("A$row").Interior.Color = 0xE5E7EB
    } elseif ($name -ne "") {
        $ws.Cells.Item($row,1) = $label
        $ws.Cells.Item($row,2) = $val
        $ws.Cells.Item($row,3) = $unit
        $ws.Cells.Item($row,4) = $name
        # Define a workbook-scoped name pointing at column B
        $wb.Names.Add($name, "=Inputs!`$B`$$row") | Out-Null
        $ws.Range("B$row").Interior.Color = 0xFFF7E6
    }
    $row++
}

$ws.Columns.Item("A").ColumnWidth = 38
$ws.Columns.Item("B").ColumnWidth = 16
$ws.Columns.Item("C").ColumnWidth = 14
$ws.Columns.Item("D").ColumnWidth = 22
$ws.Columns.Item("D").Font.Color = 0x9CA3AF
$ws.Columns.Item("D").Font.Italic = $true

# Notes
$noteRow = $row + 1
$ws.Cells.Item($noteRow,1) = "Notes:"
$ws.Cells.Item($noteRow,1).Font.Bold = $true
$notes = @(
    "Yellow cells are user-editable inputs. Column D shows the workbook-defined name.",
    "All downstream sheets reference these names; change inputs and totals recalculate automatically.",
    "installType: indoor | outdoor | mixed",
    "inBuildingType: idf | plenum | open-tray | j-hooks | surface",
    "outdoorType: direct-bury | conduit-bury | aerial | wall-mount | underground-duct",
    "outdoorConduitSize: 3/4`" | 1`" | 1-1/4`" | 2`" (default) | 4`" — only applied when installType is outdoor or mixed",
    "endDevice: switch | media-converter | direct",
    "Use the Recalculate button on Summary to force a refresh (also available via F9)."
)
for ($i=0; $i -lt $notes.Count; $i++) {
    $ws.Cells.Item($noteRow + 1 + $i, 1) = $notes[$i]
    $ws.Range("A$($noteRow + 1 + $i)`:D$($noteRow + 1 + $i)").Merge()
    $ws.Cells.Item($noteRow + 1 + $i, 1).Font.Italic = $true
    $ws.Cells.Item($noteRow + 1 + $i, 1).Font.Color = 0x6B7280
}

# ──────────────────────────────────────────────────────────────────────────
# SHEET: Lookups
# ──────────────────────────────────────────────────────────────────────────
$lk = Add-Sheet "Lookups"
$lk.Cells.Item(1,1) = "LOOKUPS — referenced by all calculation sheets"
$lk.Range("A1:H1").Merge()
$lk.Range("A1").Font.Bold = $true
$lk.Range("A1").Interior.Color = 0x0E766E
$lk.Range("A1").Font.Color = 0xFFFFFF

# AC Cable: power-tier × short/long run pairs (electricalCableRate)
$lk.Cells.Item(3,1) = "AC CABLE (electricalCableRate)"
$lk.Range("A3:F3").Merge(); $lk.Range("A3").Font.Bold = $true; $lk.Range("A3").Interior.Color = 0xE5E7EB
$acCableHeader = @("Tier max W","AWG short","Rate short `$/cond-ft","AWG long","Rate long `$/cond-ft","Long-run threshold ft")
for ($c=0; $c -lt $acCableHeader.Count; $c++) { $lk.Cells.Item(4, $c+1) = $acCableHeader[$c]; $lk.Cells.Item(4, $c+1).Font.Bold = $true }
$acCable = @(
    @(500,    "#12", 0.35, "#10", 0.45, 300),
    @(1500,   "#10", 0.45, "#8",  0.75, 300),
    @(3000,   "#8",  0.75, "#6",  1.10, 300),
    @(5000,   "#4",  1.65, "#4",  1.65, 300),
    @(10000,  "#1",  3.20, "#1",  3.20, 300),
    @(9999999,"4/0", 5.50, "4/0", 5.50, 300)
)
for ($i=0; $i -lt $acCable.Count; $i++) {
    for ($j=0; $j -lt $acCable[$i].Count; $j++) { $lk.Cells.Item(5+$i, $j+1) = $acCable[$i][$j] }
}
$wb.Names.Add("LK_ACCable", "=Lookups!`$A`$5:`$F`$10") | Out-Null

# AC Conduit (conduitRate)
$lk.Cells.Item(13,1) = "AC CONDUIT (conduitRate)"
$lk.Range("A13:E13").Merge(); $lk.Range("A13").Font.Bold = $true; $lk.Range("A13").Interior.Color = 0xE5E7EB
$conduitHeader = @("Tier max W","Size","Rate `$/ft","Labor hrs/ft","Trench-size key")
for ($c=0; $c -lt $conduitHeader.Count; $c++) { $lk.Cells.Item(14, $c+1) = $conduitHeader[$c]; $lk.Cells.Item(14, $c+1).Font.Bold = $true }
$conduit = @(
    @(1000,   "3/4""",  0.90,  0.06, "1-conduit"),
    @(2000,   "1""",    1.50,  0.08, "1-conduit"),
    @(5000,   "1-1/4""",2.50,  0.10, "2-conduit"),
    @(10000,  "2""",    4.50,  0.14, "2-conduit"),
    @(9999999,"4""",   18.00,  0.22, "4-conduit")
)
for ($i=0; $i -lt $conduit.Count; $i++) {
    for ($j=0; $j -lt $conduit[$i].Count; $j++) { $lk.Cells.Item(15+$i, $j+1) = $conduit[$i][$j] }
}
$wb.Names.Add("LK_Conduit", "=Lookups!`$A`$15:`$E`$19") | Out-Null

# CL2 Cable (class2CableSpec)
$lk.Cells.Item(22,1) = "CL2 CABLE (class2CableSpec — by distance)"
$lk.Range("A22:D22").Merge(); $lk.Range("A22").Font.Bold = $true; $lk.Range("A22").Interior.Color = 0xE5E7EB
$cl2Header = @("Max distance ft","AWG","Rate `$/pair-ft","Ohms/ft")
for ($c=0; $c -lt $cl2Header.Count; $c++) { $lk.Cells.Item(23, $c+1) = $cl2Header[$c]; $lk.Cells.Item(23, $c+1).Font.Bold = $true }
$cl2 = @(
    @(300,  "18", 0.20, 0.006385),
    @(550,  "16", 0.33, 0.004016),
    @(900,  "14", 0.55, 0.002525),
    @(1750, "12", 0.70, 0.001588)
)
for ($i=0; $i -lt $cl2.Count; $i++) {
    for ($j=0; $j -lt $cl2[$i].Count; $j++) { $lk.Cells.Item(24+$i, $j+1) = $cl2[$i][$j] }
}
$wb.Names.Add("LK_CL2Cable", "=Lookups!`$A`$24:`$D`$27") | Out-Null

# Routing multipliers
$lk.Cells.Item(30,1) = "ROUTING MULTIPLIERS"
$lk.Range("A30:C30").Merge(); $lk.Range("A30").Font.Bold = $true; $lk.Range("A30").Interior.Color = 0xE5E7EB
$lk.Cells.Item(31,1) = "Key"; $lk.Cells.Item(31,2) = "Multiplier"; $lk.Cells.Item(31,3) = "Notes"
$lk.Range("A31:C31").Font.Bold = $true
$mults = @(
    @("install_indoor",       1.00, "installType base — indoor"),
    @("install_outdoor",      1.35, "installType base — outdoor"),
    @("install_mixed",        1.15, "installType base — mixed"),
    @("ind_idf",              1.00, "in-building IDF/conduit"),
    @("ind_plenum",           1.20, "in-building plenum"),
    @("ind_open-tray",        0.85, "in-building open tray"),
    @("ind_j-hooks",          0.90, "in-building j-hooks"),
    @("ind_surface",          0.80, "in-building surface"),
    @("out_direct-bury",      1.05, "outdoor direct-bury (trenching is separate line item)"),
    @("out_conduit-bury",     1.08, "outdoor conduit-buried"),
    @("out_aerial",           0.95, "outdoor aerial"),
    @("out_wall-mount",       1.00, "outdoor wall-mount"),
    @("out_underground-duct", 1.10, "outdoor underground duct"),
    @("end_switch",           1.10, "end device — network switch"),
    @("end_media-converter",  1.05, "end device — media converter"),
    @("end_direct",           1.00, "end device — direct to device")
)
for ($i=0; $i -lt $mults.Count; $i++) {
    $lk.Cells.Item(32+$i, 1) = $mults[$i][0]
    $lk.Cells.Item(32+$i, 2) = $mults[$i][1]
    $lk.Cells.Item(32+$i, 3) = $mults[$i][2]
}
$endMultRow = 32 + $mults.Count - 1
$wb.Names.Add("LK_Mults", "=Lookups!`$A`$32:`$B`$$endMultRow") | Out-Null

# Trenching (LV)
$trRow = $endMultRow + 3
$lk.Cells.Item($trRow,1) = "TRENCHING — LV (CL2/CL4) 18-24"" depth"
$lk.Range("A$trRow`:C$trRow").Merge(); $lk.Range("A$trRow").Font.Bold = $true; $lk.Range("A$trRow").Interior.Color = 0xE5E7EB
$trRow++
$lk.Cells.Item($trRow,1) = "Key (out_*)"; $lk.Cells.Item($trRow,2) = "Rate `$/ft"; $lk.Cells.Item($trRow,3) = "Labor hrs/ft"
$lk.Range("A$trRow`:C$trRow").Font.Bold = $true
$lvTrenchStart = $trRow + 1
$lvTrench = @(
    @("direct-bury",      12.00, [math]::Round(0.5/60, 6)),
    @("conduit-bury",     18.00, [math]::Round(0.9/60, 6)),
    @("underground-duct", 22.00, [math]::Round(1.5/60, 6))
)
for ($i=0; $i -lt $lvTrench.Count; $i++) {
    $lk.Cells.Item($lvTrenchStart+$i, 1) = $lvTrench[$i][0]
    $lk.Cells.Item($lvTrenchStart+$i, 2) = $lvTrench[$i][1]
    $lk.Cells.Item($lvTrenchStart+$i, 3) = $lvTrench[$i][2]
}
$lvTrenchEnd = $lvTrenchStart + $lvTrench.Count - 1
$wb.Names.Add("LK_LVTrench", "=Lookups!`$A`$$lvTrenchStart`:`$C`$$lvTrenchEnd") | Out-Null

# Trenching (Power)
$trRow = $lvTrenchEnd + 2
$lk.Cells.Item($trRow,1) = "TRENCHING — Power (AC) 30-36"" depth"
$lk.Range("A$trRow`:C$trRow").Merge(); $lk.Range("A$trRow").Font.Bold = $true; $lk.Range("A$trRow").Interior.Color = 0xE5E7EB
$trRow++
$lk.Cells.Item($trRow,1) = "Trench key"; $lk.Cells.Item($trRow,2) = "Rate `$/ft"; $lk.Cells.Item($trRow,3) = "Labor hrs/ft"
$lk.Range("A$trRow`:C$trRow").Font.Bold = $true
$pwrTrenchStart = $trRow + 1
$pwrTrench = @(
    @("direct-bury", 18.00, [math]::Round(0.5/60, 6)),
    @("1-conduit",   25.00, [math]::Round(0.9/60, 6)),
    @("2-conduit",   30.00, [math]::Round(1.5/60, 6)),
    @("4-conduit",   45.00, [math]::Round(2.5/60, 6))
)
for ($i=0; $i -lt $pwrTrench.Count; $i++) {
    $lk.Cells.Item($pwrTrenchStart+$i, 1) = $pwrTrench[$i][0]
    $lk.Cells.Item($pwrTrenchStart+$i, 2) = $pwrTrench[$i][1]
    $lk.Cells.Item($pwrTrenchStart+$i, 3) = $pwrTrench[$i][2]
}
$pwrTrenchEnd = $pwrTrenchStart + $pwrTrench.Count - 1
$wb.Names.Add("LK_PwrTrench", "=Lookups!`$A`$$pwrTrenchStart`:`$C`$$pwrTrenchEnd") | Out-Null

$lk.Columns.Item("A").ColumnWidth = 22
$lk.Columns.Item("B").ColumnWidth = 14
$lk.Columns.Item("C").ColumnWidth = 16
$lk.Columns.Item("D").ColumnWidth = 14
$lk.Columns.Item("E").ColumnWidth = 16
$lk.Columns.Item("F").ColumnWidth = 22

# ──────────────────────────────────────────────────────────────────────────
# SHEET: Derived (intermediate computed values used by all 3 archs)
# ──────────────────────────────────────────────────────────────────────────
$dv = Add-Sheet "Derived"
$dv.Cells.Item(1,1) = "DERIVED VALUES — intermediate calcs"
$dv.Range("A1:C1").Merge(); $dv.Range("A1").Font.Bold = $true
$dv.Range("A1").Interior.Color = 0x0E766E; $dv.Range("A1").Font.Color = 0xFFFFFF

$drow = 3
function Set-Derived($wsRef, [ref]$rRef, $label, $formula, $name) {
    $r = $rRef.Value
    $wsRef.Cells.Item($r,1) = $label
    $wsRef.Cells.Item($r,2).Formula = $formula
    if ($name) {
        $wb.Names.Add($name, "=Derived!`$B`$$r") | Out-Null
        $wsRef.Cells.Item($r,3) = $name
        $wsRef.Cells.Item($r,3).Font.Color = 0x9CA3AF
        $wsRef.Cells.Item($r,3).Font.Italic = $true
    }
    $rRef.Value = $r + 1
}

$drowRef = [ref]$drow
Set-Derived $dv $drowRef "AC long-run flag (distance > 300)" "=IF(distanceFt>300,1,0)" "ac_longRun"
Set-Derived $dv $drowRef "AC AWG selected" "=IF(ac_longRun=1,INDEX(LK_ACCable,MATCH(powerW,INDEX(LK_ACCable,0,1),1)+IF(INDEX(LK_ACCable,MATCH(powerW,INDEX(LK_ACCable,0,1),1),1)<powerW,1,0),4),INDEX(LK_ACCable,MATCH(powerW,INDEX(LK_ACCable,0,1),1)+IF(INDEX(LK_ACCable,MATCH(powerW,INDEX(LK_ACCable,0,1),1),1)<powerW,1,0),2))" "ac_awg"
Set-Derived $dv $drowRef "AC cable rate `$/cond-ft" "=IF(ac_longRun=1,INDEX(LK_ACCable,MATCH(powerW,INDEX(LK_ACCable,0,1),1)+IF(INDEX(LK_ACCable,MATCH(powerW,INDEX(LK_ACCable,0,1),1),1)<powerW,1,0),5),INDEX(LK_ACCable,MATCH(powerW,INDEX(LK_ACCable,0,1),1)+IF(INDEX(LK_ACCable,MATCH(powerW,INDEX(LK_ACCable,0,1),1),1)<powerW,1,0),3))" "ac_cableRate"
Set-Derived $dv $drowRef "AC conduit size (always 2 in. indoors; outdoor uses outdoorConduitSize)" "=IF(OR(installType=`"outdoor`",installType=`"mixed`"),outdoorConduitSize,`"2`"`"`")" "ac_conduitSize"
Set-Derived $dv $drowRef "AC conduit row (lookup by size)" "=MATCH(ac_conduitSize,INDEX(LK_Conduit,0,2),0)" "ac_conduitRow"
Set-Derived $dv $drowRef "AC conduit rate `$/ft" "=INDEX(LK_Conduit,ac_conduitRow,3)" "ac_conduitRate"
Set-Derived $dv $drowRef "AC conduit labor hrs/ft" "=INDEX(LK_Conduit,ac_conduitRow,4)" "ac_conduitLabor"
Set-Derived $dv $drowRef "AC trench size key" "=INDEX(LK_Conduit,ac_conduitRow,5)" "ac_trenchKey"
Set-Derived $dv $drowRef "AC conductor count (3 if <=2000, else 5)" "=IF(powerW<=2000,3,5)" "ac_wireCount"
Set-Derived $dv $drowRef "AC conduit ft (distance × 1.15)" "=distanceFt*1.15" "ac_conduitFt"
Set-Derived $dv $drowRef "AC cable ft (distance × 1.18)" "=distanceFt*1.18" "ac_cableFt"
Set-Derived $dv $drowRef "AC pull boxes (max(0, ceil(conduitFt/100)-1))" "=MAX(0,CEILING(ac_conduitFt/100,1)-1)" "ac_pullBoxQty"
Set-Derived $dv $drowRef "AC core drill qty (max(1, ceil(distance/150)))" "=MAX(1,CEILING(distanceFt/150,1))" "ac_coreDrillQty"
Set-Derived $dv $drowRef "AC isSimple (dist<260 AND power<2000)" "=IF(AND(distanceFt<260,powerW<2000),1,0)" "ac_isSimple"
Set-Derived $dv $drowRef "AC isFull (power>10000 OR distance>800)" "=IF(OR(powerW>10000,distanceFt>800),1,0)" "ac_isFull"
Set-Derived $dv $drowRef "AC useConduitOverride (override>0)" "=IF(conduitOverride>0,1,0)" "ac_useOverride"
Set-Derived $dv $drowRef "AC effective conduit `$/ft" "=IF(ac_useOverride=1,conduitOverride,ac_conduitRate)" "ac_effConduitRate"
Set-Derived $dv $drowRef "AC effective conduit labor hrs/ft" "=IF(ac_useOverride=1,0,IF(ac_isSimple=1,0.05,ac_conduitLabor))" "ac_effConduitLabor"

$dv.Cells.Item($drow,1) = "— CL2 —"; $dv.Cells.Item($drow,1).Font.Bold = $true; $drow++
$drowRef = [ref]$drow
Set-Derived $dv $drowRef "CL2 distance (clamped to 1750)" "=MIN(distanceFt,1750)" "cl2_dist"
Set-Derived $dv $drowRef "CL2 cable row (by distance)" "=MATCH(cl2_dist,INDEX(LK_CL2Cable,0,1),1)+IF(INDEX(LK_CL2Cable,MATCH(cl2_dist,INDEX(LK_CL2Cable,0,1),1),1)<cl2_dist,1,0)" "cl2_cableRow"
Set-Derived $dv $drowRef "CL2 AWG" "=INDEX(LK_CL2Cable,cl2_cableRow,2)" "cl2_awg"
Set-Derived $dv $drowRef "CL2 cable rate `$/pair-ft" "=INDEX(LK_CL2Cable,cl2_cableRow,3)" "cl2_cableRate"
Set-Derived $dv $drowRef "CL2 ohms/ft" "=INDEX(LK_CL2Cable,cl2_cableRow,4)" "cl2_ohms"
Set-Derived $dv $drowRef "CL2 pairs (ceil(power/100))" "=MAX(1,CEILING(powerW/100,1))" "cl2_pairs"
Set-Derived $dv $drowRef "CL2 total conductors" "=cl2_pairs*2" "cl2_conductors"
Set-Derived $dv $drowRef "CL2 pull groups (ceil(conductors/8))" "=CEILING(cl2_conductors/8,1)" "cl2_pullGroups"
Set-Derived $dv $drowRef "CL2 avg conductors per pull" "=cl2_conductors/cl2_pullGroups" "cl2_avgPerPull"
Set-Derived $dv $drowRef "CL2 pull efficiency factor" "=MAX(0.55,1-(cl2_avgPerPull-1)*0.057)" "cl2_pullEff"
Set-Derived $dv $drowRef "CL2 labor /ft per group" "=(1/110)*cl2_pullEff" "cl2_laborPerFtGroup"
Set-Derived $dv $drowRef "CL2 pathway ft (cl2_dist × 1.05)" "=cl2_dist*1.05" "cl2_pathwayFt"
Set-Derived $dv $drowRef "CL2 cable pair-ft (pairs × cl2_dist × 1.10)" "=cl2_pairs*cl2_dist*1.10" "cl2_cablePairFt"
Set-Derived $dv $drowRef "CL2 pull labor hrs (groups × cl2_dist × 1.10 × labor)" "=cl2_pullGroups*cl2_dist*1.10*cl2_laborPerFtGroup" "cl2_pullHrs"
Set-Derived $dv $drowRef "CL2 DC hubs (ceil(power/300))" "=MAX(1,CEILING(powerW/300,1))" "cl2_dcHubQty"
Set-Derived $dv $drowRef "CL2 J-hooks (ceil(pathwayFt/6))" "=CEILING(cl2_pathwayFt/6,1)" "cl2_jHookQty"
Set-Derived $dv $drowRef "CL2 penetrations (max(1, ceil(cl2_dist/200)))" "=MAX(1,CEILING(cl2_dist/200,1))" "cl2_penetrations"

$dv.Cells.Item($drow,1) = "— CL4 —"; $dv.Cells.Item($drow,1).Font.Bold = $true; $drow++
$drowRef = [ref]$drow
Set-Derived $dv $drowRef "CL4 voltage drop (V)" "=2.8*2*0.004016*distanceFt" "cl4_vdrop"
Set-Derived $dv $drowRef "CL4 effective voltage (max 80% floor)" "=MAX(450*0.8,450-cl4_vdrop)" "cl4_veff"
Set-Derived $dv $drowRef "CL4 watts per pair" "=cl4_veff*2.8*0.92" "cl4_wattsPerPair"
Set-Derived $dv $drowRef "CL4 pair count" "=MAX(1,CEILING(powerW/cl4_wattsPerPair,1))" "cl4_pairs"
Set-Derived $dv $drowRef "CL4 total conductors" "=cl4_pairs*2" "cl4_conductors"
Set-Derived $dv $drowRef "CL4 channels (ceil(power/1300))" "=MAX(1,CEILING(powerW/1300,1))" "cl4_channels"
Set-Derived $dv $drowRef "CL4 receivers (ceil(power/1500))" "=MAX(1,CEILING(powerW/1500,1))" "cl4_receivers"
Set-Derived $dv $drowRef "CL4 cable rate `$/ft (1=`$1.10, 2=`$1.22, 3+=`$1.36)" "=IF(cl4_pairs<=1,1.10,IF(cl4_pairs<=2,1.22,1.36))" "cl4_cableRate"
Set-Derived $dv $drowRef "CL4 cable ft (distance × 1.10)" "=distanceFt*1.10" "cl4_cableFt"
Set-Derived $dv $drowRef "CL4 run ft (distance × 1.10)" "=distanceFt*1.10" "cl4_runFt"
Set-Derived $dv $drowRef "CL4 pathway supports (ceil(runFt/8))" "=CEILING(cl4_runFt/8,1)" "cl4_pathwaySupports"
Set-Derived $dv $drowRef "CL4 penetrations (max(1, ceil(distance/200)))" "=MAX(1,CEILING(distanceFt/200,1))" "cl4_penetrations"

$dv.Cells.Item($drow,1) = "— Routing & End-Device Multipliers —"; $dv.Cells.Item($drow,1).Font.Bold = $true; $drow++
$drowRef = [ref]$drow
Set-Derived $dv $drowRef "Install base mult" "=VLOOKUP(`"install_`"&installType,LK_Mults,2,FALSE)" "mult_installBase"
Set-Derived $dv $drowRef "Indoor sub-mult (only when indoor or mixed)" "=IF(OR(installType=`"indoor`",installType=`"mixed`"),VLOOKUP(`"ind_`"&inBuildingType,LK_Mults,2,FALSE),1)" "mult_indoor"
Set-Derived $dv $drowRef "Outdoor sub-mult (only when outdoor or mixed)" "=IF(OR(installType=`"outdoor`",installType=`"mixed`"),VLOOKUP(`"out_`"&outdoorType,LK_Mults,2,FALSE),1)" "mult_outdoor"
Set-Derived $dv $drowRef "AC routing mult (full)" "=mult_installBase*mult_indoor*mult_outdoor" "mult_acRouting"
Set-Derived $dv $drowRef "CL2/CL4 routing mult (50% of delta)" "=1+(mult_acRouting-1)*0.5" "mult_lvRouting"
Set-Derived $dv $drowRef "End device mult" "=VLOOKUP(`"end_`"&endDevice,LK_Mults,2,FALSE)" "mult_endDevice"
Set-Derived $dv $drowRef "AC trench rate `$/ft (0 if not outdoor)" "=IF(AND(OR(installType=`"outdoor`",installType=`"mixed`"),OR(outdoorType=`"direct-bury`",outdoorType=`"conduit-bury`",outdoorType=`"underground-duct`")),IF(outdoorType=`"direct-bury`",VLOOKUP(`"direct-bury`",LK_PwrTrench,2,FALSE),VLOOKUP(ac_trenchKey,LK_PwrTrench,2,FALSE)),0)" "ac_trenchRate"
Set-Derived $dv $drowRef "AC trench labor hrs/ft" "=IF(AND(OR(installType=`"outdoor`",installType=`"mixed`"),OR(outdoorType=`"direct-bury`",outdoorType=`"conduit-bury`",outdoorType=`"underground-duct`")),IF(outdoorType=`"direct-bury`",VLOOKUP(`"direct-bury`",LK_PwrTrench,3,FALSE),VLOOKUP(ac_trenchKey,LK_PwrTrench,3,FALSE)),0)" "ac_trenchLabor"
Set-Derived $dv $drowRef "LV trench rate `$/ft" "=IF(AND(OR(installType=`"outdoor`",installType=`"mixed`"),OR(outdoorType=`"direct-bury`",outdoorType=`"conduit-bury`",outdoorType=`"underground-duct`")),VLOOKUP(outdoorType,LK_LVTrench,2,FALSE),0)" "lv_trenchRate"
Set-Derived $dv $drowRef "LV trench labor hrs/ft" "=IF(AND(OR(installType=`"outdoor`",installType=`"mixed`"),OR(outdoorType=`"direct-bury`",outdoorType=`"conduit-bury`",outdoorType=`"underground-duct`")),VLOOKUP(outdoorType,LK_LVTrench,3,FALSE),0)" "lv_trenchLabor"

$dv.Columns.Item("A").ColumnWidth = 56
$dv.Columns.Item("B").ColumnWidth = 18
$dv.Columns.Item("C").ColumnWidth = 26

# ──────────────────────────────────────────────────────────────────────────
# Helper to build a calc sheet given a list of line items
# Each row: phase, activity, quantity-formula, unit, laborUnits-formula,
#          laborRate-formula, materialUnitCost-formula, materialQty-formula, conditionFlagFormula(or "")
# ──────────────────────────────────────────────────────────────────────────
function Build-CalcSheet($name, $title, $rows, $multName, $deviceMultName, $crewSizeName) {
    $cs = Add-Sheet $name
    $cs.Cells.Item(1,1) = $title
    $cs.Range("A1:K1").Merge()
    $cs.Range("A1").Font.Bold = $true; $cs.Range("A1").Font.Size = 13
    $cs.Range("A1").Interior.Color = 0x0E766E; $cs.Range("A1").Font.Color = 0xFFFFFF

    $headers = @("Active","Phase","Activity","Qty","Unit","Labor hrs/unit","Labor hrs","Labor rate","Material cost","Labor cost","Line total")
    for ($c=0; $c -lt $headers.Count; $c++) {
        $cs.Cells.Item(3, $c+1) = $headers[$c]
        $cs.Cells.Item(3, $c+1).Font.Bold = $true
        $cs.Cells.Item(3, $c+1).Interior.Color = 0xE5E7EB
    }

    $startRow = 4
    $r = $startRow
    foreach ($item in $rows) {
        $phase     = $item.phase
        $activity  = $item.activity
        $qtyF      = $item.qty
        $unit      = $item.unit
        $laborUnitsF = $item.laborUnits
        $rateF     = $item.rate
        $matCostF  = $item.matCost
        $matQtyF   = $item.matQty
        $cond      = $item.cond  # "1" or formula returning 1/0

        if ($cond -and $cond -ne "") { $cs.Cells.Item($r,1).Formula = "=$cond" } else { $cs.Cells.Item($r,1) = 1 }
        $cs.Cells.Item($r,2) = $phase
        $cs.Cells.Item($r,3) = $activity
        $cs.Cells.Item($r,4).Formula = "=$qtyF"
        $cs.Cells.Item($r,5) = $unit
        $cs.Cells.Item($r,6).Formula = "=$laborUnitsF"
        # Determine multiplier: phases starting "3) " or "5) " use $multName; "4) " uses $deviceMultName
        $multExpr = "IF(OR(LEFT(B$r,2)=`"3)`",LEFT(B$r,2)=`"5)`"),$multName,IF(LEFT(B$r,2)=`"4)`",$deviceMultName,1))"
        # Active flag gates the entire row
        $cs.Cells.Item($r,7).Formula  = "=A$r*D$r*F$r"                                # labor hours
        $cs.Cells.Item($r,8).Formula  = "=$rateF"                                     # labor rate
        $cs.Cells.Item($r,9).Formula  = "=A$r*$matCostF*$matQtyF*$multExpr"           # material cost (with mult)
        $cs.Cells.Item($r,10).Formula = "=A$r*G$r*H$r*$multExpr"                      # labor cost (with mult)
        $cs.Cells.Item($r,11).Formula = "=I$r+J$r"                                    # line total
        $r++
    }
    $endRow = $r - 1

    # Totals row
    $r++
    $cs.Cells.Item($r,3) = "TOTALS"; $cs.Cells.Item($r,3).Font.Bold = $true
    $cs.Cells.Item($r,7).Formula  = "=SUM(G$startRow`:G$endRow)"
    $cs.Cells.Item($r,9).Formula  = "=SUM(I$startRow`:I$endRow)"
    $cs.Cells.Item($r,10).Formula = "=SUM(J$startRow`:J$endRow)"
    $cs.Cells.Item($r,11).Formula = "=SUM(K$startRow`:K$endRow)"
    $cs.Range("G$r`:K$r").Font.Bold = $true
    $cs.Range("G$r`:K$r").Interior.Color = 0xFEF3C7

    # Design vs install hours (design = phases 1-2; install = 3-6)
    $r += 2
    $cs.Cells.Item($r,3) = "Design hours (phases 1-2)"
    $cs.Cells.Item($r,7).Formula = "=SUMPRODUCT((LEFT(B$startRow`:B$endRow,2)=""1)"")*G$startRow`:G$endRow)+SUMPRODUCT((LEFT(B$startRow`:B$endRow,2)=""2)"")*G$startRow`:G$endRow)"
    $r++
    $cs.Cells.Item($r,3) = "Install hours (phases 3-6)"
    $cs.Cells.Item($r,7).Formula = "=G$($r-3)-G$($r-1)"
    $r++
    $cs.Cells.Item($r,3) = "Design days (hours / 8)"
    $cs.Cells.Item($r,7).Formula = "=G$($r-2)/8"
    $r++
    $cs.Cells.Item($r,3) = "Install days (hours / 8 / crew)"
    $cs.Cells.Item($r,7).Formula = "=G$($r-2)/8/$crewSizeName"
    $r++
    $cs.Cells.Item($r,3) = "TOTAL DAYS"
    $cs.Cells.Item($r,3).Font.Bold = $true
    $cs.Cells.Item($r,7).Formula = "=G$($r-2)+G$($r-1)"
    $cs.Cells.Item($r,7).Font.Bold = $true; $cs.Cells.Item($r,7).Interior.Color = 0xFEF3C7

    # Define named totals for Summary
    $totalRowNum = $endRow + 2
    $wb.Names.Add("$($name)_Total",      "=$name!`$K`$$totalRowNum") | Out-Null
    $wb.Names.Add("$($name)_Material",   "=$name!`$I`$$totalRowNum") | Out-Null
    $wb.Names.Add("$($name)_Labor",      "=$name!`$J`$$totalRowNum") | Out-Null
    $wb.Names.Add("$($name)_Hours",      "=$name!`$G`$$totalRowNum") | Out-Null
    $wb.Names.Add("$($name)_TotalDays",  "=$name!`$G`$$r") | Out-Null

    # Column widths
    $cs.Columns.Item("A").ColumnWidth = 7
    $cs.Columns.Item("B").ColumnWidth = 32
    $cs.Columns.Item("C").ColumnWidth = 42
    $cs.Columns.Item("D").ColumnWidth = 11
    $cs.Columns.Item("E").ColumnWidth = 7
    $cs.Columns.Item("F").ColumnWidth = 13
    $cs.Columns.Item("G").ColumnWidth = 11
    $cs.Columns.Item("H").ColumnWidth = 11
    $cs.Columns.Item("I").ColumnWidth = 14
    $cs.Columns.Item("J").ColumnWidth = 14
    $cs.Columns.Item("K").ColumnWidth = 14
    # Currency formats
    $cs.Range("H$startRow`:K$endRow").NumberFormat = "$#,##0.00"
    $cs.Range("I$($endRow+2)`:K$($endRow+2)").NumberFormat = "$#,##0.00"
}

# ──────────────────────────────────────────────────────────────────────────
# AC line items — full fidelity (Simple/Standard/Full via Active flag)
# ──────────────────────────────────────────────────────────────────────────
$acRows = @()
# Phase 1
$acRows += @{ phase="1) Design and Engineering"; activity="Power design package";
              qty="1"; unit="lot";
              laborUnits="IF(ac_isSimple=1,12,MAX(14,6+distanceFt/500+powerW/1800))";
              rate="rateDesign"; matCost="0"; matQty="0"; cond="1" }
$acRows += @{ phase="1) Design and Engineering"; activity="Submittals and coordination drawings";
              qty="1"; unit="lot";
              laborUnits="IF(ac_isFull=1,12,10)"; rate="rateDesigner"; matCost="0"; matQty="0";
              cond="IF(ac_isSimple=1,0,1)" }
# Phase 2
$acRows += @{ phase="2) Permitting and Preconstruction"; activity="Preconstruction survey";
              qty="1"; unit="lot"; laborUnits="5"; rate="rateDesign"; matCost="0"; matQty="0"; cond="1" }
$acRows += @{ phase="2) Permitting and Preconstruction"; activity="Permit and inspection coordination";
              qty="1"; unit="lot";
              laborUnits="IF(ac_isSimple=1,8,MAX(16,8+distanceFt/1000))"; rate="rateDesign";
              matCost="IF(ac_isSimple=1,150,500)"; matQty="1"; cond="1" }
$acRows += @{ phase="2) Permitting and Preconstruction"; activity="AHJ review and plan check period";
              qty="1"; unit="lot"; laborUnits="MAX(84,60+distanceFt/500)"; rate="rateWait";
              matCost="0"; matQty="0"; cond="IF(ac_isSimple=1,0,1)" }
$acRows += @{ phase="2) Permitting and Preconstruction"; activity="Mobilization and safety plan";
              qty="1"; unit="lot"; laborUnits="IF(ac_isFull=1,16,12)"; rate="rateDesign";
              matCost="0"; matQty="0"; cond="IF(ac_isSimple=1,0,1)" }
# Phase 3
$acRows += @{ phase="3) Pathway and Distribution Build"; activity="Conduit installation";
              qty="ac_conduitFt"; unit="ft"; laborUnits="ac_effConduitLabor"; rate="rateElectrician";
              matCost="ac_effConduitRate"; matQty="ac_conduitFt"; cond="1" }
$acRows += @{ phase="3) Pathway and Distribution Build"; activity="Pull boxes and junction boxes";
              qty="ac_pullBoxQty"; unit="ea"; laborUnits="1.75"; rate="rateElectrician";
              matCost="250"; matQty="ac_pullBoxQty"; cond="IF(ac_pullBoxQty>0,1,0)" }
$acRows += @{ phase="3) Pathway and Distribution Build"; activity="Core drilling, wall penetrations, firestop";
              qty="ac_coreDrillQty"; unit="ea"; laborUnits="1.6"; rate="rateLaborer";
              matCost="75"; matQty="ac_coreDrillQty"; cond="IF(ac_isSimple=1,0,1)" }
$acRows += @{ phase="3) Pathway and Distribution Build"; activity="Trenching and earthwork";
              qty="ac_conduitFt"; unit="ft"; laborUnits="ac_trenchLabor"; rate="rateLaborer";
              matCost="ac_trenchRate"; matQty="ac_conduitFt"; cond="IF(ac_trenchRate>0,1,0)" }
$acRows += @{ phase="3) Pathway and Distribution Build"; activity="Grounding and bonding";
              qty="1"; unit="lot"; laborUnits="4"; rate="rateElectrician";
              matCost="200"; matQty="1"; cond="IF(ac_isSimple=1,0,1)" }
# Phase 4 — three branches use Active flag
$acRows += @{ phase="4) Power Equipment Install"; activity="Receptacle and device installation (Simple)";
              qty="1"; unit="ea"; laborUnits="1.5"; rate="rateElectrician";
              matCost="45"; matQty="1"; cond="ac_isSimple" }
$acRows += @{ phase="4) Power Equipment Install"; activity="Breaker installation in existing panel (Standard)";
              qty="1"; unit="ea"; laborUnits="3"; rate="rateElectrician";
              matCost="IF(powerW<=2000,30,250)"; matQty="1"; cond="IF(AND(ac_isSimple=0,ac_isFull=0),1,0)" }
$acRows += @{ phase="4) Power Equipment Install"; activity="Panelboard installation (Full)";
              qty="1"; unit="ea"; laborUnits="10"; rate="rateElectrician";
              matCost="IF(powerW<=5000,1200,2500)"; matQty="1"; cond="ac_isFull" }
$acRows += @{ phase="4) Power Equipment Install"; activity="Transformer installation (Full)";
              qty="1"; unit="ea"; laborUnits="16"; rate="rateElectrician";
              matCost="4500"; matQty="1"; cond="ac_isFull" }
$acRows += @{ phase="4) Power Equipment Install"; activity="Feeder breaker in source gear (Full)";
              qty="1"; unit="ea"; laborUnits="6"; rate="rateElectrician";
              matCost="2500"; matQty="1"; cond="ac_isFull" }
# Phase 5
$acRows += @{ phase="5) Cable Installation and Termination"; activity="Conductor pull";
              qty="ac_cableFt"; unit="ft";
              laborUnits="IF(ac_isSimple=1,0.03,IF(powerW>5000,0.06,0.04))";
              rate="rateElectrician"; matCost="ac_cableRate*ac_wireCount"; matQty="ac_cableFt"; cond="1" }
$acRows += @{ phase="5) Cable Installation and Termination"; activity="Termination and labeling";
              qty="1"; unit="lot";
              laborUnits="IF(ac_isSimple=1,1.5,4+powerW/3000)"; rate="rateElectrician";
              matCost="IF(ac_isSimple=1,35,250)"; matQty="1"; cond="1" }
$acRows += @{ phase="5) Cable Installation and Termination"; activity="Panel schedules and circuit directories";
              qty="1"; unit="lot"; laborUnits="IF(ac_isFull=1,8,4)"; rate="rateDesigner";
              matCost="0"; matQty="0"; cond="IF(ac_isSimple=1,0,1)" }
# Phase 6
$acRows += @{ phase="6) Testing and Commissioning"; activity="Circuit verification and closeout (Simple)";
              qty="1"; unit="lot"; laborUnits="2"; rate="rateElectrician";
              matCost="0"; matQty="0"; cond="ac_isSimple" }
$acRows += @{ phase="6) Testing and Commissioning"; activity="Megger and insulation testing";
              qty="1"; unit="lot"; laborUnits="IF(ac_isFull=1,12,4)"; rate="rateElectrician";
              matCost="80"; matQty="1"; cond="IF(ac_isSimple=1,0,1)" }
$acRows += @{ phase="6) Testing and Commissioning"; activity="Torque verification (Full)";
              qty="1"; unit="lot"; laborUnits="8"; rate="rateElectrician";
              matCost="0"; matQty="0"; cond="ac_isFull" }
$acRows += @{ phase="6) Testing and Commissioning"; activity="Functional performance testing";
              qty="1"; unit="lot"; laborUnits="IF(ac_isFull=1,10,4)"; rate="rateElectrician";
              matCost="0"; matQty="0"; cond="IF(ac_isSimple=1,0,1)" }
$acRows += @{ phase="6) Testing and Commissioning"; activity="Closeout and owner handoff";
              qty="1"; unit="lot"; laborUnits="IF(ac_isFull=1,18,8)"; rate="rateDesign";
              matCost="0"; matQty="0"; cond="IF(ac_isSimple=1,0,1)" }
$acRows += @{ phase="6) Testing and Commissioning"; activity="Punchlist corrections (Full)";
              qty="1"; unit="lot"; laborUnits="16"; rate="rateDesign";
              matCost="0"; matQty="0"; cond="ac_isFull" }

Build-CalcSheet "AC_Calc" "Class 1 AC — Detailed Line Items" $acRows "mult_acRouting" "mult_endDevice" "crewSize"

# ──────────────────────────────────────────────────────────────────────────
# CL2 line items
# ──────────────────────────────────────────────────────────────────────────
$cl2Rows = @()
$cl2Rows += @{ phase="1) Design and Engineering"; activity="Low-voltage system design";
               qty="1"; unit="lot"; laborUnits="4+cl2_pairs*0.4"; rate="rateDesign";
               matCost="0"; matQty="0"; cond="1" }
$cl2Rows += @{ phase="1) Design and Engineering"; activity="Submittals and procurement";
               qty="1"; unit="lot"; laborUnits="4"; rate="rateLvTech";
               matCost="0"; matQty="0"; cond="1" }
$cl2Rows += @{ phase="2) Permitting and Preconstruction"; activity="Preconstruction survey";
               qty="1"; unit="lot"; laborUnits="3+cl2_dist/1200"; rate="rateDesign";
               matCost="0"; matQty="0"; cond="1" }
$cl2Rows += @{ phase="2) Permitting and Preconstruction"; activity="AHJ package and plan review";
               qty="1"; unit="lot"; laborUnits="3"; rate="rateDesign";
               matCost="250"; matQty="1"; cond="1" }
$cl2Rows += @{ phase="2) Permitting and Preconstruction"; activity="Mobilization and safety plan";
               qty="1"; unit="lot"; laborUnits="6"; rate="rateDesign";
               matCost="0"; matQty="0"; cond="1" }
$cl2Rows += @{ phase="3) Pathway and Distribution Build"; activity="J-hook and pathway support installation";
               qty="cl2_pathwayFt"; unit="ft"; laborUnits="1/110"; rate="rateLvTech";
               matCost="4.5"; matQty="cl2_jHookQty"; cond="1" }
$cl2Rows += @{ phase="3) Pathway and Distribution Build"; activity="Core drilling, wall penetrations, firestop";
               qty="cl2_penetrations"; unit="ea"; laborUnits="0.85"; rate="rateLaborer";
               matCost="45"; matQty="cl2_penetrations"; cond="1" }
$cl2Rows += @{ phase="3) Pathway and Distribution Build"; activity="Trenching and earthwork";
               qty="cl2_pathwayFt"; unit="ft"; laborUnits="lv_trenchLabor"; rate="rateLaborer";
               matCost="lv_trenchRate"; matQty="cl2_pathwayFt"; cond="IF(lv_trenchRate>0,1,0)" }
$cl2Rows += @{ phase="4) Power Equipment Install"; activity="DC hub deployment";
               qty="cl2_dcHubQty"; unit="ea"; laborUnits="0.5"; rate="rateLvTech";
               matCost="520"; matQty="cl2_dcHubQty"; cond="1" }
$cl2Rows += @{ phase="4) Power Equipment Install"; activity="PoE injector deployment";
               qty="cl2_pairs"; unit="ea"; laborUnits="0.25"; rate="rateLvTech";
               matCost="160"; matQty="cl2_pairs"; cond="1" }
$cl2Rows += @{ phase="5) Cable Installation and Termination"; activity="Class 2 cable pull";
               qty="1"; unit="lot"; laborUnits="cl2_pullHrs"; rate="rateLvTech";
               matCost="cl2_cableRate"; matQty="cl2_cablePairFt"; cond="1" }
$cl2Rows += @{ phase="5) Cable Installation and Termination"; activity="Termination and connector attachment";
               qty="1"; unit="lot"; laborUnits="1.5+cl2_pairs*0.3"; rate="rateLvTech";
               matCost="95"; matQty="1"; cond="1" }
$cl2Rows += @{ phase="5) Cable Installation and Termination"; activity="Cable management and labeling";
               qty="1"; unit="lot"; laborUnits="1+cl2_pairs*0.15"; rate="rateLvTech";
               matCost="65"; matQty="1"; cond="1" }
$cl2Rows += @{ phase="6) Testing and Commissioning"; activity="Certification and load testing";
               qty="1"; unit="lot"; laborUnits="2+cl2_pairs*0.15"; rate="rateLvTech";
               matCost="65"; matQty="1"; cond="1" }
$cl2Rows += @{ phase="6) Testing and Commissioning"; activity="Functional performance verification";
               qty="1"; unit="lot"; laborUnits="2"; rate="rateLvTech";
               matCost="0"; matQty="0"; cond="1" }
$cl2Rows += @{ phase="6) Testing and Commissioning"; activity="Closeout and owner handoff";
               qty="1"; unit="lot"; laborUnits="4"; rate="rateDesign";
               matCost="0"; matQty="0"; cond="1" }
$cl2Rows += @{ phase="6) Testing and Commissioning"; activity="Punchlist corrections";
               qty="1"; unit="lot"; laborUnits="4"; rate="rateDesign";
               matCost="0"; matQty="0"; cond="1" }

Build-CalcSheet "CL2_Calc" "Class 2 DC — Detailed Line Items" $cl2Rows "mult_lvRouting" "mult_endDevice" "crewSize"

# ──────────────────────────────────────────────────────────────────────────
# CL4 line items
# ──────────────────────────────────────────────────────────────────────────
$cl4Rows = @()
$cl4Rows += @{ phase="1) Design and Engineering"; activity="Class 4 system design";
               qty="1"; unit="lot"; laborUnits="5+distanceFt/600"; rate="rateDesign";
               matCost="0"; matQty="0"; cond="1" }
$cl4Rows += @{ phase="1) Design and Engineering"; activity="Submittals and procurement";
               qty="1"; unit="lot"; laborUnits="4"; rate="rateLvTech";
               matCost="0"; matQty="0"; cond="1" }
$cl4Rows += @{ phase="2) Permitting and Preconstruction"; activity="Preconstruction survey";
               qty="1"; unit="lot"; laborUnits="2"; rate="rateDesign";
               matCost="0"; matQty="0"; cond="1" }
$cl4Rows += @{ phase="2) Permitting and Preconstruction"; activity="AHJ package and pathway review";
               qty="1"; unit="lot"; laborUnits="3.5"; rate="rateDesign";
               matCost="350"; matQty="1"; cond="1" }
$cl4Rows += @{ phase="2) Permitting and Preconstruction"; activity="Mobilization and safety plan";
               qty="1"; unit="lot"; laborUnits="6"; rate="rateDesign";
               matCost="0"; matQty="0"; cond="1" }
$cl4Rows += @{ phase="3) Pathway and Distribution Build"; activity="CL4 pathway and support installation";
               qty="cl4_runFt"; unit="ft"; laborUnits="1/140"; rate="rateLvTech";
               matCost="4.5"; matQty="cl4_pathwaySupports"; cond="1" }
$cl4Rows += @{ phase="3) Pathway and Distribution Build"; activity="Core drilling, wall penetrations, firestop";
               qty="cl4_penetrations"; unit="ea"; laborUnits="0.85"; rate="rateLaborer";
               matCost="45"; matQty="cl4_penetrations"; cond="1" }
$cl4Rows += @{ phase="3) Pathway and Distribution Build"; activity="Trenching and earthwork";
               qty="cl4_runFt"; unit="ft"; laborUnits="lv_trenchLabor"; rate="rateLaborer";
               matCost="lv_trenchRate"; matQty="cl4_runFt"; cond="IF(lv_trenchRate>0,1,0)" }
$cl4Rows += @{ phase="4) Power Equipment Install"; activity="FMP head-end installation";
               qty="cl4_channels"; unit="ch"; laborUnits="1.5"; rate="rateLvTech";
               matCost="2600"; matQty="cl4_channels"; cond="1" }
$cl4Rows += @{ phase="4) Power Equipment Install"; activity="FMP receiver hardware deployment";
               qty="cl4_receivers"; unit="ea"; laborUnits="1.0"; rate="rateLvTech";
               matCost="1650"; matQty="cl4_receivers"; cond="1" }
$cl4Rows += @{ phase="5) Cable Installation and Termination"; activity="CL4 copper cable installation";
               qty="cl4_cableFt"; unit="ft"; laborUnits="1/110"; rate="rateLvTech";
               matCost="cl4_cableRate"; matQty="cl4_cableFt"; cond="1" }
$cl4Rows += @{ phase="5) Cable Installation and Termination"; activity="Termination and connector attachment";
               qty="1"; unit="lot"; laborUnits="2+cl4_channels*0.3"; rate="rateLvTech";
               matCost="180"; matQty="1"; cond="1" }
$cl4Rows += @{ phase="5) Cable Installation and Termination"; activity="Cable management and labeling";
               qty="1"; unit="lot"; laborUnits="1.5"; rate="rateLvTech";
               matCost="65"; matQty="1"; cond="1" }
$cl4Rows += @{ phase="6) Testing and Commissioning"; activity="CL4 power-up and fault validation";
               qty="1"; unit="lot"; laborUnits="2+cl4_channels*0.8"; rate="rateLvTech";
               matCost="90"; matQty="1"; cond="1" }
$cl4Rows += @{ phase="6) Testing and Commissioning"; activity="Functional performance verification";
               qty="1"; unit="lot"; laborUnits="2+cl4_channels*0.4"; rate="rateLvTech";
               matCost="0"; matQty="0"; cond="1" }
$cl4Rows += @{ phase="6) Testing and Commissioning"; activity="Closeout and owner handoff";
               qty="1"; unit="lot"; laborUnits="6"; rate="rateDesign";
               matCost="0"; matQty="0"; cond="1" }
$cl4Rows += @{ phase="6) Testing and Commissioning"; activity="Punchlist corrections";
               qty="1"; unit="lot"; laborUnits="4"; rate="rateDesign";
               matCost="0"; matQty="0"; cond="1" }

Build-CalcSheet "CL4_Calc" "Class 4 FMP — Detailed Line Items" $cl4Rows "mult_lvRouting" "mult_endDevice" "crewSize"

# ──────────────────────────────────────────────────────────────────────────
# SHEET: Summary (with macro buttons)
# ──────────────────────────────────────────────────────────────────────────
$sm = Add-Sheet "Summary"
$sm.Cells.Item(1,1) = "POWER DELIVERY COMPARISON — SUMMARY"
$sm.Range("A1:F1").Merge()
$sm.Range("A1").Font.Bold = $true; $sm.Range("A1").Font.Size = 16
$sm.Range("A1").Interior.Color = 0x0E766E; $sm.Range("A1").Font.Color = 0xFFFFFF
$sm.Range("A1").HorizontalAlignment = -4108  # xlCenter

$sm.Cells.Item(3,1) = "Inputs:"; $sm.Cells.Item(3,1).Font.Bold = $true
$sm.Cells.Item(3,2).Formula = "=`"Power: `"&powerW&`" W | Distance: `"&distanceFt&`" ft | Crew: `"&crewSize&`" | Install: `"&installType"
$sm.Range("B3:F3").Merge()

$sm.Cells.Item(5,1) = "Architecture"
$sm.Cells.Item(5,2) = "Total Cost"
$sm.Cells.Item(5,3) = "Materials"
$sm.Cells.Item(5,4) = "Labor"
$sm.Cells.Item(5,5) = "Hours"
$sm.Cells.Item(5,6) = "Days"
$sm.Range("A5:F5").Font.Bold = $true
$sm.Range("A5:F5").Interior.Color = 0xE5E7EB

$sm.Cells.Item(6,1) = "Class 1 AC"
$sm.Cells.Item(6,2).Formula = "=AC_Calc_Total"
$sm.Cells.Item(6,3).Formula = "=AC_Calc_Material"
$sm.Cells.Item(6,4).Formula = "=AC_Calc_Labor"
$sm.Cells.Item(6,5).Formula = "=AC_Calc_Hours"
$sm.Cells.Item(6,6).Formula = "=AC_Calc_TotalDays"

$sm.Cells.Item(7,1) = "Class 2 DC"
$sm.Cells.Item(7,2).Formula = "=CL2_Calc_Total"
$sm.Cells.Item(7,3).Formula = "=CL2_Calc_Material"
$sm.Cells.Item(7,4).Formula = "=CL2_Calc_Labor"
$sm.Cells.Item(7,5).Formula = "=CL2_Calc_Hours"
$sm.Cells.Item(7,6).Formula = "=CL2_Calc_TotalDays"

$sm.Cells.Item(8,1) = "Class 4 FMP"
$sm.Cells.Item(8,2).Formula = "=CL4_Calc_Total"
$sm.Cells.Item(8,3).Formula = "=CL4_Calc_Material"
$sm.Cells.Item(8,4).Formula = "=CL4_Calc_Labor"
$sm.Cells.Item(8,5).Formula = "=CL4_Calc_Hours"
$sm.Cells.Item(8,6).Formula = "=CL4_Calc_TotalDays"

$sm.Range("B6:D8").NumberFormat = "$#,##0.00"
$sm.Range("E6:F8").NumberFormat = "0.0"

# Lowest-cost highlight via conditional format
$rng = $sm.Range("B6:B8")
$cf = $rng.FormatConditions.Add(2, 6, "=MIN(`$B`$6:`$B`$8)")  # 2=xlExpression
$cf.Interior.Color = 0xC6EFCE
$cf.Font.Color = 0x006100

# Fastest highlight on Days column
$rng2 = $sm.Range("F6:F8")
$cf2 = $rng2.FormatConditions.Add(2, 6, "=MIN(`$F`$6:`$F`$8)")
$cf2.Interior.Color = 0xFFEB9C
$cf2.Font.Color = 0x9C5700

# Phase comparison block
$sm.Cells.Item(11,1) = "Phase Cost Comparison ($)"; $sm.Cells.Item(11,1).Font.Bold = $true
$sm.Range("A11:F11").Merge(); $sm.Range("A11").Interior.Color = 0xE5E7EB
$phases = @(
    "1) Design and Engineering",
    "2) Permitting and Preconstruction",
    "3) Pathway and Distribution Build",
    "4) Power Equipment Install",
    "5) Cable Installation and Termination",
    "6) Testing and Commissioning"
)
$sm.Cells.Item(12,1) = "Phase"
$sm.Cells.Item(12,2) = "Class 1 AC"
$sm.Cells.Item(12,3) = "Class 2 DC"
$sm.Cells.Item(12,4) = "Class 4 FMP"
$sm.Range("A12:D12").Font.Bold = $true

for ($i=0; $i -lt $phases.Count; $i++) {
    $r = 13 + $i
    $sm.Cells.Item($r,1) = $phases[$i]
    $sm.Cells.Item($r,2).Formula = "=SUMIFS(AC_Calc!K:K,AC_Calc!B:B,A$r)"
    $sm.Cells.Item($r,3).Formula = "=SUMIFS(CL2_Calc!K:K,CL2_Calc!B:B,A$r)"
    $sm.Cells.Item($r,4).Formula = "=SUMIFS(CL4_Calc!K:K,CL4_Calc!B:B,A$r)"
}
$sm.Range("B13:D$($r)").NumberFormat = "$#,##0.00"

$sm.Columns.Item("A").ColumnWidth = 36
$sm.Columns.Item("B").ColumnWidth = 16
$sm.Columns.Item("C").ColumnWidth = 16
$sm.Columns.Item("D").ColumnWidth = 16
$sm.Columns.Item("E").ColumnWidth = 12
$sm.Columns.Item("F").ColumnWidth = 12

# Reorder sheets: Summary first
$wb.Sheets.Item("Summary").Move($wb.Sheets.Item(1)) | Out-Null

# ──────────────────────────────────────────────────────────────────────────
# Add VBA macros — requires Trust access to VBA project
# ──────────────────────────────────────────────────────────────────────────
$vbaCode = @"
Option Explicit

' Default labor + input values mirror the web tool's defaults
Public Sub ResetInputs()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("Inputs")
    Application.ScreenUpdating = False
    On Error Resume Next
    ThisWorkbook.Names("powerW").RefersToRange.Value = 1500
    ThisWorkbook.Names("distanceFt").RefersToRange.Value = 500
    ThisWorkbook.Names("crewSize").RefersToRange.Value = 3
    ThisWorkbook.Names("conduitOverride").RefersToRange.Value = 0
    ThisWorkbook.Names("installType").RefersToRange.Value = "indoor"
    ThisWorkbook.Names("inBuildingType").RefersToRange.Value = "idf"
    ThisWorkbook.Names("outdoorType").RefersToRange.Value = "direct-bury"
    ThisWorkbook.Names("outdoorConduitSize").RefersToRange.Value = "2"""
    ThisWorkbook.Names("endDevice").RefersToRange.Value = "switch"
    ThisWorkbook.Names("rateElectrician").RefersToRange.Value = 31.11
    ThisWorkbook.Names("rateLvTech").RefersToRange.Value = 28.51
    ThisWorkbook.Names("rateDesign").RefersToRange.Value = 51.43
    ThisWorkbook.Names("rateDesigner").RefersToRange.Value = 35.44
    ThisWorkbook.Names("rateLaborer").RefersToRange.Value = 22.47
    ThisWorkbook.Names("rateWait").RefersToRange.Value = 0
    On Error GoTo 0
    Application.CalculateFull
    Application.ScreenUpdating = True
    MsgBox "Inputs reset to defaults.", vbInformation, "Reset Complete"
End Sub

Public Sub Recalculate()
    Application.CalculateFull
    MsgBox "Recalculation complete.", vbInformation, "Recalculate"
End Sub

Public Sub ExportSummaryPDF()
    Dim ws As Worksheet
    Dim path As String
    Set ws = ThisWorkbook.Sheets("Summary")
    path = ThisWorkbook.Path
    If Len(path) = 0 Then
        MsgBox "Please save the workbook first.", vbExclamation
        Exit Sub
    End If
    Dim outFile As String
    outFile = path & Application.PathSeparator & "Summary_" & Format(Now, "yyyymmdd_hhnnss") & ".pdf"
    ws.ExportAsFixedFormat Type:=0, Filename:=outFile, Quality:=0, _
        IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=True
    MsgBox "Summary exported to:" & vbCrLf & outFile, vbInformation, "Export PDF"
End Sub
"@

$vbaInjected = $false
try {
    $vbProj = $wb.VBProject
    $module = $vbProj.VBComponents.Add(1)  # 1 = vbext_ct_StdModule
    $module.Name = "PDCM_Macros"
    $module.CodeModule.AddFromString($vbaCode)
    $vbaInjected = $true
} catch {
    Write-Warning "Could not inject VBA module automatically. To enable macros, open Excel > File > Options > Trust Center > Trust Center Settings > Macro Settings, and tick 'Trust access to the VBA project object model'. Then re-run this script."
}

# Add buttons to Summary sheet (only if VBA injected)
if ($vbaInjected) {
    $sm.Activate() | Out-Null
    # Form button: Recalculate
    $btn1 = $sm.Buttons().Add(450, 10, 110, 28)
    $btn1.Caption = "Recalculate"
    $btn1.OnAction = "PDCM_Macros.Recalculate"
    # Form button: Reset
    $btn2 = $sm.Buttons().Add(565, 10, 110, 28)
    $btn2.Caption = "Reset Inputs"
    $btn2.OnAction = "PDCM_Macros.ResetInputs"
    # Form button: Export PDF
    $btn3 = $sm.Buttons().Add(680, 10, 110, 28)
    $btn3.Caption = "Export PDF"
    $btn3.OnAction = "PDCM_Macros.ExportSummaryPDF"
}

# Final formatting + save
$wb.Sheets.Item("Summary").Activate() | Out-Null
$excel.ScreenUpdating = $true

# 52 = xlOpenXMLWorkbookMacroEnabled (.xlsm)
$wb.SaveAs($outPath, 52)
$wb.Close($false)
$excel.Quit()

[System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
[GC]::Collect(); [GC]::WaitForPendingFinalizers()

if ($vbaInjected) {
    Write-Host "Created: $outPath (with macros)" -ForegroundColor Green
} else {
    Write-Host "Created: $outPath (formulas only — VBA not injected; see warning above)" -ForegroundColor Yellow
}
