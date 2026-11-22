"""Exporte les sprites pixel art vers public/js/sprites.js.
Usage : cd tools/pixelart && python3 export.py   (python3 build.py produit une planche d'aperçu casters.png)
h = hauteur du sprite exprimée en « tailles » de monstre ; walk = images de marche ; atk = image d'attaque ; float = flotte."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from build import SPR
META = {
  'goblin': {'h': 2.5, 'walk': [0, 1], 'atk': 2},
  'goblin_archer': {'h': 2.5, 'walk': [0, 1]},
  'witch': {'h': 3.5, 'walk': [0, 1], 'float': 1},
  'lich': {'h': 3.1, 'walk': [0, 1], 'float': 1},
  'wolf': {'h': 1.7, 'walk': [0, 1], 'atk': 2},
  'hound': {'h': 1.8, 'walk': [0, 1], 'atk': 2},
  'cerberus': {'h': 2.2, 'walk': [0, 1]},
  'boar': {'h': 1.7, 'walk': [0, 1]},
  'bear': {'h': 1.8, 'walk': [0, 1]},
  'golem': {'h': 2.9, 'walk': [0, 1], 'atk': 2},
  'yeti': {'h': 2.9, 'walk': [0, 1], 'atk': 2},
  'ghost': {'h': 2.6, 'walk': [0, 1], 'float': 1},
  'phoenix': {'h': 2.2, 'walk': [0, 1], 'float': 1},
  'treant': {'h': 3.6, 'walk': [0, 1], 'atk': 2},
  'crawler': {'h': 1.1, 'walk': [0, 1], 'atk': 2},
  'toad': {'h': 1.5, 'walk': [0, 1], 'atk': 2},
  'shroom': {'h': 2.2, 'walk': [0, 1], 'atk': 2},
  'zombie': {'h': 2.7, 'walk': [0, 1], 'atk': 2},
  'spider': {'h': 1.4, 'walk': [0, 1], 'atk': 2},
  'imp': {'h': 2.4, 'walk': [0, 1], 'atk': 2},
  'salamander': {'h': 1.3, 'walk': [0, 1]},
  'elemental': {'h': 3.2, 'walk': [0, 1], 'atk': 2},
  'mother': {'h': 2.3, 'walk': [0, 1], 'atk': 2},
  'skeleton': {'h': 2.3, 'walk': [0, 1], 'atk': 2},
}
data = {k: {**META[k], 'pal': v['pal'], 'variants': v.get('variants', {}), 'frames': v['frames']} for k, v in SPR.items() if k in META}
missing = [k for k in SPR if k not in META]
assert not missing, missing
out = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'js', 'sprites.js')
with open(out, 'w') as f:
    f.write('/* Sprites pixel art des monstres — fichier GÉNÉRÉ par tools/pixelart/export.py, ne pas modifier à la main. */\n')
    f.write('window.PixelSprites = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print('écrit', out, os.path.getsize(out), 'octets')
