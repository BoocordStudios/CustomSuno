# Deterministic resize of the user-supplied logo. Preserve its artwork and ratio.
param([string]$SourcePath = (Join-Path $PSScriptRoot '..\..\logo.png'))

Add-Type -AssemblyName System.Drawing
$iconDirectory = $PSScriptRoot
$source = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SourcePath).Path)
$iconSizes = @(16, 32, 48, 128, 256)
$entries = @()
try {
    foreach ($iconSize in $iconSizes) {
        $bitmap = [System.Drawing.Bitmap]::new($iconSize, $iconSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $scale = [Math]::Min($iconSize / [double]$source.Width, $iconSize / [double]$source.Height)
            $width = [single]($source.Width * $scale)
            $height = [single]($source.Height * $scale)
            $rectangle = [System.Drawing.RectangleF]::new([single](($iconSize - $width) / 2), [single](($iconSize - $height) / 2), $width, $height)
            $graphics.DrawImage($source, $rectangle)
            $filename = if ($iconSize -eq 256) { '128x128@2x.png' } else { "${iconSize}x${iconSize}.png" }
            $destination = Join-Path $iconDirectory $filename
            $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
            $entries += [PSCustomObject]@{ Size = $iconSize; Bytes = [System.IO.File]::ReadAllBytes($destination) }
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $source.Dispose()
}
$iconStream = [System.IO.File]::Create((Join-Path $iconDirectory 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($iconStream)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$entries.Count)
    $offset = 6 + 16 * $entries.Count
    foreach ($entry in $entries) {
        $encodedSize = if ($entry.Size -eq 256) { 0 } else { $entry.Size }
        $writer.Write([byte]$encodedSize)
        $writer.Write([byte]$encodedSize)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$entry.Bytes.Length)
        $writer.Write([uint32]$offset)
        $offset += $entry.Bytes.Length
    }
    foreach ($entry in $entries) { $writer.Write([byte[]]$entry.Bytes) }
} finally {
    $writer.Dispose()
}
