import { UIKitMLAsset, Vector3, World } from '@iwsdk/core';
import { Campfire, GameState } from '../game/components.js';
import { OBJECTIVES, currentObjective } from '../game/story.js';

/** Opt-in development recorder. Captures the application's actual renderer. */
export function attachCapture(world: World): void {
  const hot = import.meta.hot;
  if (!hot) return;
  const output = document.createElement('canvas');
  output.width = 1280; output.height = 840;
  const ctx = output.getContext('2d')!;
  const state = world.requireSceneEntity('game');
  const fire = world.requireSceneEntity('campfire');
  const buttonPoint = new Vector3();
  const value = (field: keyof typeof GameState.schema) => state.getValue(GameState, field);
  let title = ''; let recorder: MediaRecorder | undefined; let name = '';
  let chunks: Blob[] = []; let lastFrame = 0;
  const originalAfterRender = world.scene.onAfterRender;
  world.scene.onAfterRender = (...args) => {
    originalAfterRender.apply(world.scene, args);
    if (!recorder || args[0] !== world.renderer || performance.now() - lastFrame < 1000 / 30) return;
    lastFrame = performance.now();
    const source = world.renderer.domElement;
    ctx.fillStyle = '#101c17'; ctx.fillRect(0, 0, 1280, 840);
    const scale = Math.min(1280 / source.width, 720 / source.height);
    const width = source.width * scale; const height = source.height * scale;
    ctx.drawImage(source, (1280 - width) / 2, 60 + (720 - height) / 2, width, height);
    ctx.fillStyle = '#f0ddba'; ctx.font = 'bold 25px sans-serif'; ctx.fillText(title, 26, 39);
    ctx.font = '18px sans-serif'; ctx.fillStyle = '#fff';
    const objective = currentObjective(Number(value('objectives')));
    ctx.fillText(`Day ${value('day')}   •   Fire ${fire.getValue(Campfire, 'lit') ? 'lit' : 'cold'} ${Math.round(Number(fire.getValue(Campfire, 'fuel')))}   •   Hunger ${Math.round(Number(value('hunger')))}   •   Health ${Math.round(Number(value('health')))}   •   Stage ${value('stage')}   •   ${objective >= 0 ? OBJECTIVES[objective].title : 'Journey complete'}`, 26, 818);
  };
  hot.on('camp-video:command', async ({ id, action, ...command }) => {
    try {
      if (command.title) title = command.title;
      if (action === 'start') {
        if (recorder) throw new Error('Already recording');
        name = command.name; chunks = [];
        const stream = output.captureStream(30);
        recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 6_000_000 });
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.start(1000);
      } else if (action === 'click-enter') {
        // Exercise the browser pointer path and the actual Enter VR handler.
        const button = world.requireSceneObject<UIKitMLAsset>('camp-journal').requireElementById('enter-xr');
        button.getWorldPosition(buttonPoint).project(world.camera);
        const canvas = world.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        const pointer = { clientX: rect.left + (buttonPoint.x + 1) * rect.width / 2,
          clientY: rect.top + (1 - buttonPoint.y) * rect.height / 2,
          pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, button: 0 };
        canvas.dispatchEvent(new PointerEvent('pointermove', { ...pointer, buttons: 0 }));
        canvas.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
      } else if (action === 'stop') {
        if (!recorder) throw new Error('No recording');
        const current = recorder;
        await new Promise<void>(resolve => { current.onstop = () => resolve(); current.stop(); });
        const response = await fetch(`/__camp-video?name=${encodeURIComponent(name)}`, { method: 'POST', body: new Blob(chunks, { type: 'video/webm' }) });
        if (!response.ok) throw new Error(await response.text());
        current.stream.getTracks().forEach(track => track.stop());
        recorder = undefined; chunks = [];
      }
      hot.send('camp-video:result', { id, result: { ok: true, recording: Boolean(recorder), name, width: world.renderer.domElement.width, height: world.renderer.domElement.height } });
    } catch (error) { hot.send('camp-video:result', { id, result: { error: String(error) } }); }
  });
  hot.dispose(() => { recorder?.stream.getTracks().forEach(track => track.stop()); world.scene.onAfterRender = originalAfterRender; });
}
