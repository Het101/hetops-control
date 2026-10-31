<script lang="ts">
  import { checkParams } from "@hetops-control/contracts";
  import { track, ui } from "../lib/action-state.svelte.js";
  import { defaults, fields, preview, start } from "../lib/actions.js";

  // one confirming dialog for every action: the form comes from the descriptor, the text from the agent's own preview
  let dlg = $state<HTMLDialogElement>();
  let values = $state<Record<string, string | number | boolean>>({});
  let text = $state<string>(), error = $state<string>(), busy = $state(false), typed = $state("");
  let key = "";
  const o = $derived(ui.open);
  $effect(() => {
    if (!o || !dlg || dlg.open) return;
    values = defaults(o.descriptor.params); typed = ""; error = undefined; text = undefined; key = crypto.randomUUID();
    dlg.showModal();
  });
  // the preview follows the params, so what the dialog says is exactly what will be asked
  $effect(() => {
    if (!o) return;
    const p = checkParams(o.descriptor.params, $state.snapshot(values));
    text = undefined;
    if (!p.ok) { error = p.error; return; }
    error = undefined;
    const t = setTimeout(() => preview(o.entity, o.ref.id, p.params).then(x => (text = x), e => (error = (e as Error).message)), 200);
    return () => clearTimeout(t);
  });
  const disruptive = $derived(o?.descriptor.risk === "disruptive");
  const ready = $derived(!!o && !!text && !error && !busy && (!disruptive || typed === o.entity.name));
  async function confirm() {
    if (!o || !ready) return;
    const p = checkParams(o.descriptor.params, $state.snapshot(values)); if (!p.ok) return;
    busy = true;
    try { track(await start(o.entity, o.ref.id, p.params, key, disruptive ? typed : undefined)); dlg?.close(); }
    catch (e) { error = (e as Error).message; }
    finally { busy = false; }
  }
</script>

<dialog bind:this={dlg} class="act-dlg raised" aria-labelledby="act-h" onclose={() => (ui.open = undefined)}>
  {#if o}
    <form onsubmit={e => { e.preventDefault(); void confirm(); }}>
      <span class="kicker">{disruptive ? "DISRUPTIVE" : "SAFE"} · {o.entity.server.toUpperCase()}</span>
      <h2 id="act-h">{o.descriptor.label} {o.entity.name}</h2>
      {#each fields(o.descriptor.params) as f (f.key)}
        <div class="fld">
          {#if f.kind === "choice"}
            <span class="fld-l" id={`f-${f.key}`}>{f.label}</span>
            <div class="chips" role="radiogroup" aria-labelledby={`f-${f.key}`}>
              {#each f.options as v (v)}<label class="chip" class:on={values[f.key] === v}><input type="radio" name={f.key} value={v} bind:group={values[f.key]} />{v}</label>{/each}
            </div>
          {:else if f.kind === "toggle"}
            <label class="fld-l"><input type="checkbox" checked={values[f.key] === true} onchange={e => (values[f.key] = e.currentTarget.checked)} /> {f.label}</label>
          {:else if f.kind === "number"}
            <label class="fld-l">{f.label} <input class="pressed" type="number" min={f.min} max={f.max} bind:value={values[f.key]} /></label>
          {:else}
            <label class="fld-l">{f.label} <input class="pressed" type="text" maxlength={f.max} bind:value={values[f.key]} /></label>
          {/if}
          {#if f.help}<small>{f.help}</small>{/if}
        </div>
      {/each}
      <p class="what" aria-live="polite">{text ?? (error ? "" : `Asking ${o.entity.server} what will happen…`)}</p>
      {#if error}<p class="err" role="alert">{error}</p>{/if}
      {#if disruptive}
        <label class="fld-l">Type <b>{o.entity.name}</b> to confirm <input class="pressed" autocomplete="off" spellcheck="false" bind:value={typed} /></label>
      {/if}
      <div class="btns">
        <button type="button" class="act-back raised" onclick={() => dlg?.close()}>Cancel</button>
        <!-- silver, not ember: confirming is the owner's choice, not something that needs them -->
        <button type="submit" class="act-go raised" disabled={!ready}>{busy ? "Asking…" : o.descriptor.label}</button>
      </div>
    </form>
  {/if}
</dialog>
