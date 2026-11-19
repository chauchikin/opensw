# The fixed test with real Scientific Word 5.5 (Windows, 5.5 installed at C:\sw55):
#   powershell -ExecutionPolicy Bypass -File scripts\open55batch.ps1 -dir <folder of .tex> -out <log>
# Open the originals once and the copies opensw saved (scripts/edit55.mjs) once, then compare
# the two logs: a copy should open whenever its original does, with no "truncated".
param([string]$dir, [string]$out, [int]$secs = 60, [int]$restart = 25)
Add-Type @"
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public class D55{public delegate bool P(IntPtr h,IntPtr l);
[DllImport("user32.dll")]static extern bool EnumWindows(P p,IntPtr l);
[DllImport("user32.dll")]static extern bool EnumChildWindows(IntPtr w,P p,IntPtr l);
[DllImport("user32.dll")]static extern int GetWindowThreadProcessId(IntPtr h,out int pid);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")]public static extern IntPtr SendMessage(IntPtr h,int m,IntPtr w,IntPtr l);
[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,int m,IntPtr w,IntPtr l);
static string T(IntPtr h){var s=new StringBuilder(512);GetWindowText(h,s,512);return s.ToString();}
static string C(IntPtr h){var s=new StringBuilder(256);GetClassName(h,s,256);return s.ToString();}
public static List<IntPtr> Dialogs(int id){var r=new List<IntPtr>();EnumWindows((h,l)=>{int p;GetWindowThreadProcessId(h,out p);if(p==id&&IsWindowVisible(h)&&C(h)=="#32770")r.Add(h);return true;},IntPtr.Zero);return r;}
public static string Title(int id){string t="";EnumWindows((h,l)=>{int p;GetWindowThreadProcessId(h,out p);if(p==id&&IsWindowVisible(h)&&C(h)!="#32770"&&T(h).Length>0)t=T(h);return true;},IntPtr.Zero);return t;}
public static string Read(IntPtr d){var sb=new StringBuilder();EnumChildWindows(d,(h,l)=>{if(C(h)=="Static"&&T(h).Length>0)sb.Append(T(h)+" | ");return true;},IntPtr.Zero);return T(d)+": "+sb.ToString();}
public static bool Ok(IntPtr d){IntPtr b=IntPtr.Zero;EnumChildWindows(d,(h,l)=>{if(C(h)=="Button"&&b==IntPtr.Zero&&(T(h)=="確定"||T(h)=="OK"))b=h;return true;},IntPtr.Zero);if(b==IntPtr.Zero)return false;PostMessage(b,0x00F5,IntPtr.Zero,IntPtr.Zero);return true;}
}
"@ -ErrorAction Stop
Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;
public class M{public delegate bool P(IntPtr h,IntPtr l);
[DllImport("user32.dll")]static extern bool EnumWindows(P p,IntPtr l);
[DllImport("user32.dll")]static extern bool EnumChildWindows(IntPtr w,P p,IntPtr l);
[DllImport("user32.dll")]static extern int GetWindowThreadProcessId(IntPtr h,out int pid);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll")]static extern IntPtr SendMessage(IntPtr h,int m,IntPtr w,IntPtr l);
[DllImport("user32.dll")]static extern bool PostMessage(IntPtr h,int m,IntPtr w,IntPtr l);
static string C(IntPtr h){var s=new StringBuilder(256);GetClassName(h,s,256);return s.ToString();}
// closes the active document window (MDI child) of process id
public static bool CloseDoc(int id){IntPtr mdi=IntPtr.Zero;EnumWindows((h,l)=>{int p;GetWindowThreadProcessId(h,out p);if(p==id&&mdi==IntPtr.Zero)EnumChildWindows(h,(c,x)=>{if(mdi==IntPtr.Zero&&C(c)=="MDIClient")mdi=c;return true;},IntPtr.Zero);return true;},IntPtr.Zero);
 if(mdi==IntPtr.Zero)return false;IntPtr a=SendMessage(mdi,0x0229,IntPtr.Zero,IntPtr.Zero);if(a==IntPtr.Zero)return false;PostMessage(a,0x0010,IntPtr.Zero,IntPtr.Zero);return true;}
[DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
static string T(IntPtr h){var s=new StringBuilder(256);GetWindowText(h,s,256);return s.ToString();}
// "save changes?" after closing an unchanged document: press No (否)
public static bool No(int id){bool done=false;EnumWindows((h,l)=>{int p;GetWindowThreadProcessId(h,out p);if(p==id&&IsWindowVisible(h)&&C(h)=="#32770")EnumChildWindows(h,(c,x)=>{string t=T(c).Replace("&","");if(!done&&C(c)=="Button"&&(t=="否(N)"||t=="否"||t=="No")){PostMessage(c,0x00F5,IntPtr.Zero,IntPtr.Zero);done=true;}return true;},IntPtr.Zero);return true;},IntPtr.Zero);return done;}
}
"@
# Opens every .tex under $dir in Scientific Word 5.5 (C:\sw55\sciword.exe), one at a time in one
# running 5.5 (a second launch hands the file to it), and writes one line per file to $out:
# file <TAB> result <TAB> the dialogs 5.5 showed. OK is pressed only on dialogs known to be
# harmless (license, registry) or the reading errors being tested; any other dialog stops
# that file and 5.5 is started again. 5.5 is restarted every $restart files.
function Watch($q, $want, $secs) {
  $msgs = [ordered]@{}; $quiet = 0; $result = 'timeout'
  for ($t = 0; $t -lt $secs; $t++) {
    Start-Sleep 1
    $real = 0; $stop = $false
    foreach ($d in [D55]::Dialogs($q.Id)) {
      $m = ([D55]::Read($d) -replace "`r?`n", ' ').Trim()
      if ($m -match '^:\s*$') { continue }
      $real++
      if (-not $msgs.Contains($m)) { $msgs[$m] = 0 }; $msgs[$m]++
      if ($msgs[$m] -gt 30) { $result = 'looping'; $stop = $true; break }
      if ($m -match 'License|Failed to update the system registry|Error while reading|truncated|occurs more than once|Could not import file|not found\.') { [void][D55]::Ok($d) }
      else { $result = 'stopped at a dialog'; $stop = $true; break }
    }
    if ($stop) { break }
    $main = [D55]::Title($q.Id)
    if ($main -and $main.Contains($want) -and $real -eq 0) { $quiet++ } else { $quiet = 0 }
    if ($quiet -ge 3) { $result = 'opened'; break }
  }
  if ($result -eq 'opened' -and ($msgs.Keys -match 'Error while reading|truncated')) { $result = 'truncated' }
  return @($result, (($msgs.Keys | Where-Object { $_ -notmatch 'License|registry' }) -join ' || '))
}
function Start55 {
  Get-Process sciword -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 1
  $blank = Join-Path $env:TEMP 'blank55.tex'
  if (-not (Test-Path $blank)) { "\documentclass{article}`r`n\begin{document}`r`n`r`n\end{document}`r`n" | Out-File $blank -Encoding ascii }
  [void](Start-Process C:\sw55\sciword.exe -ArgumentList ('"' + $blank + '"') -PassThru)
  for ($i = 0; $i -lt 30 -and -not ($q = Get-Process sciword -ErrorAction SilentlyContinue | Select -First 1); $i++) { Start-Sleep 1 }
  [void](Watch $q 'blank55' 150)
  return $q
}
$files = Get-ChildItem -LiteralPath $dir -Recurse -File | Where-Object { $_.Extension -match '^\.tex$' } | Sort-Object FullName
"file`tresult`tdialogs" | Out-File -LiteralPath $out -Encoding utf8
$q = Start55; $k = 0
foreach ($f in $files) {
  if ($k -ge $restart -or $q.HasExited) { $q = Start55; $k = 0 }
  $k++
  Start-Process C:\sw55\sciword.exe -ArgumentList ('"' + $f.FullName + '"')
  $r = Watch $q $f.FullName $secs
  "$($f.FullName.Substring($dir.Length + 1))`t$($r[0])`t$($r[1])" | Out-File -LiteralPath $out -Append -Encoding utf8
  if ($r[0] -in 'opened', 'truncated') { [void][M]::CloseDoc($q.Id); Start-Sleep 1; if ([M]::No($q.Id)) { Start-Sleep 1 } } else { $q = Start55; $k = 0 }
}
Get-Process sciword -ErrorAction SilentlyContinue | Stop-Process -Force
"done" | Out-File -LiteralPath $out -Append -Encoding utf8
