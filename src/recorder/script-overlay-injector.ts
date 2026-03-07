// Script overlay — injects a floating panel into the page showing current script step
// Human reads instructions, presses Space to advance, Esc to stop recording

import type { Page } from "playwright";
import type { TutorialScript } from "../script/script-types.js";

/**
 * Inject script overlay into page.
 * Scene boundary timestamps captured via window.__vf_scene_marks.
 */
export async function injectScriptOverlay(
  page: Page,
  script: TutorialScript
): Promise<void> {
  // Serialize script data and inject as browser-context JS string
  const scriptJSON = JSON.stringify(script);
  await page.evaluate(`(function() {
    var scriptData = ${scriptJSON};
    window.__vf_scene_marks = window.__vf_scene_marks || [];
    window.__vf_current_step = window.__vf_current_step || 0;
    window.__vf_recording_done = false;

    // Remove existing overlay if re-injecting after navigation
    var existing = document.getElementById("__vf_overlay");
    if (existing) existing.remove();

    var steps = scriptData.steps;
    var overlay = document.createElement("div");
    overlay.id = "__vf_overlay";
    overlay.style.cssText = "position:fixed;top:16px;right:16px;z-index:999999;width:320px;padding:16px;border-radius:12px;background:rgba(0,0,0,0.85);color:#fff;font-family:system-ui,sans-serif;font-size:13px;line-height:1.5;box-shadow:0 4px 20px rgba(0,0,0,0.4);backdrop-filter:blur(8px);user-select:none;transition:opacity 0.3s;";

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function render() {
      var idx = window.__vf_current_step;
      if (idx >= steps.length) {
        overlay.innerHTML = '<div style="color:#4ade80;font-weight:600;font-size:15px;">All steps complete!</div><div style="margin-top:8px;color:#aaa;">Press <kbd style="background:#333;padding:2px 6px;border-radius:4px;">Esc</kbd> to stop recording</div>';
        return;
      }
      var step = steps[idx];
      var next = idx + 1 < steps.length ? steps[idx + 1] : null;
      var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="color:#60a5fa;font-weight:600;">Step ' + step.step + '/' + steps.length + '</span><span style="color:#888;font-size:11px;">~' + step.expectedDurationSec + 's</span></div>';
      html += '<div style="font-size:14px;font-weight:500;margin-bottom:10px;">' + esc(step.instruction) + '</div>';
      if (next) html += '<div style="color:#888;font-size:12px;border-top:1px solid #333;padding-top:8px;">Next: ' + esc(next.instruction) + '</div>';
      html += '<div style="margin-top:10px;color:#666;font-size:11px;"><kbd style="background:#333;padding:2px 6px;border-radius:4px;">Space</kbd> Next step <kbd style="background:#333;padding:2px 6px;border-radius:4px;margin-left:8px;">Esc</kbd> Stop</div>';
      overlay.innerHTML = html;
    }

    document.addEventListener("keydown", function(e) {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        var idx = window.__vf_current_step;
        window.__vf_scene_marks.push({ step: idx + 2, ms: Date.now() - (window.__vf_startTime || Date.now()) });
        window.__vf_current_step = idx + 1;
        render();
      }
      if (e.code === "Escape") {
        window.__vf_recording_done = true;
        overlay.style.opacity = "0";
      }
    });

    document.body.appendChild(overlay);
    render();

    // Mark first scene start if not already marked
    if (window.__vf_scene_marks.length === 0) {
      window.__vf_scene_marks.push({ step: 1, ms: 0 });
    }
  })()`);
}

/** Check if human pressed Esc to stop recording */
export async function isRecordingDone(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(`!!window.__vf_recording_done`) as boolean;
  } catch {
    return true;
  }
}

/** Get scene boundary marks from overlay hotkey presses */
export async function getSceneMarks(page: Page): Promise<Array<{ step: number; ms: number }>> {
  try {
    return await page.evaluate(`window.__vf_scene_marks || []`) as Array<{ step: number; ms: number }>;
  } catch {
    return [];
  }
}
