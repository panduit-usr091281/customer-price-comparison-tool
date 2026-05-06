Attribute VB_Name = "PDCM_Macros"
Option Explicit

' ─────────────────────────────────────────────────────────────────────────────
' Power Delivery Comparison Model — VBA Macros
' Import this file via Excel: Alt+F11 -> File -> Import File -> select PDCM_Macros.bas
' Then assign the three procedures to buttons or run via Alt+F8.
' ─────────────────────────────────────────────────────────────────────────────

' Reset all inputs (yellow cells on Inputs sheet) to their default values.
Public Sub ResetInputs()
    Application.ScreenUpdating = False
    On Error Resume Next
    ThisWorkbook.Names("powerW").RefersToRange.Value = 1500
    ThisWorkbook.Names("distanceFt").RefersToRange.Value = 500
    ThisWorkbook.Names("crewSize").RefersToRange.Value = 3
    ThisWorkbook.Names("conduitOverride").RefersToRange.Value = 0
    ThisWorkbook.Names("installType").RefersToRange.Value = "indoor"
    ThisWorkbook.Names("inBuildingType").RefersToRange.Value = "idf"
    ThisWorkbook.Names("outdoorType").RefersToRange.Value = "direct-bury"
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

' Force a full recalculation of the workbook.
Public Sub Recalculate()
    Application.CalculateFull
    MsgBox "Recalculation complete.", vbInformation, "Recalculate"
End Sub

' Export the Summary sheet to PDF in the workbook's folder.
Public Sub ExportSummaryPDF()
    Dim ws As Worksheet
    Dim path As String
    Dim outFile As String
    Set ws = ThisWorkbook.Sheets("Summary")
    path = ThisWorkbook.path
    If Len(path) = 0 Then
        MsgBox "Please save the workbook first.", vbExclamation
        Exit Sub
    End If
    outFile = path & Application.PathSeparator & "Summary_" & Format(Now, "yyyymmdd_hhnnss") & ".pdf"
    ws.ExportAsFixedFormat Type:=0, Filename:=outFile, Quality:=0, _
        IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=True
    MsgBox "Summary exported to:" & vbCrLf & outFile, vbInformation, "Export PDF"
End Sub
