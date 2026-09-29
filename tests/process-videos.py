"""Export actual runtime recordings as seekable MP4 and inspectable frame sheets."""
import json
from pathlib import Path
import subprocess

folder = Path('design/verify/videos')
manifest = []
for source in sorted(folder.glob('[0-9][0-9]-*.webm')):
    target = source.with_suffix('.mp4')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                    '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p',
                    '-r', '30', '-movflags', '+faststart', str(target)], check=True)
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration,size:stream=width,height,avg_frame_rate,nb_frames', '-of', 'json', str(target)]))
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(target), '-f', 'null', '-'], check=True)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', str(target),
        '-frames:v', '1', str(folder / f'{source.stem}-poster.jpg')], check=True)
    manifest.append({'file': target.name, **info})
    print(target.name, info['format']['duration'], 'seconds', flush=True)
(folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
