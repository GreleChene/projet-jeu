import sys
sys.path.insert(0, '.')
from gen import sheet
import s_casters as S, gob, gob_archer, s_beasts as B, s_giants as G, s_corrupt as K, s_inferno as N, s_allies as Y
def gframes():
    out = []
    for f in ({}, gob.WALK2, gob.ATK):
        r = list(gob.BASE)
        for k, v in f.items(): r[k] = v
        out.append(r)
    return out
SPR = {
  'goblin': {'pal': gob.PAL, 'frames': gframes()},
  'goblin_archer': {'pal': gob.PAL, 'frames': [gob_archer.archer(0), gob_archer.archer(1)]},
  'witch': {'pal': S.WITCH_PAL, 'frames': [S.witch(i) for i in range(2)]},
  'lich': {'pal': S.LICH_PAL, 'frames': [S.lich(i) for i in (0, 3)]},
  'wolf': {'pal': B.WOLF_PAL, 'variants': B.WOLF_VAR, 'frames': [B.wolf(0), B.wolf(1), B.wolf(2)]},
  'hound': {'pal': B.HOUND_PAL, 'frames': [B.wolf(0, True), B.wolf(1, True), B.wolf(2, True)]},
  'cerberus': {'pal': B.HOUND_PAL, 'frames': [B.cerberus(0), B.cerberus(1)]},
  'boar': {'pal': B.BOAR_PAL, 'variants': B.BOAR_VAR, 'frames': [B.boar(0), B.boar(1)]},
  'bear': {'pal': B.BEAR_PAL, 'frames': [B.bear(0), B.bear(1)]},
  'golem': {'pal': G.GOLEM_PAL, 'variants': G.GOLEM_VAR, 'frames': [G.golem(0), G.golem(1), G.golem(2)]},
  'yeti': {'pal': G.YETI_PAL, 'frames': [G.yeti(0), G.yeti(1), G.yeti(2)]},
  'ghost': {'pal': G.GHOST_PAL, 'frames': [G.ghost(0), G.ghost(1)]},
  'phoenix': {'pal': G.PHOENIX_PAL, 'frames': [G.phoenix(0), G.phoenix(1)]},
  'treant': {'pal': K.TREANT_PAL, 'variants': K.TREANT_VAR, 'frames': [K.treant(0), K.treant(1), K.treant(2)]},
  'crawler': {'pal': K.CRAWL_PAL, 'frames': [K.crawler(0), K.crawler(1), K.crawler(2)]},
  'toad': {'pal': K.TOAD_PAL, 'variants': K.TOAD_VAR, 'frames': [K.toad(0), K.toad(1), K.toad(2)]},
  'shroom': {'pal': K.SHROOM_PAL, 'variants': K.SHROOM_VAR, 'frames': [K.shroom(0), K.shroom(1), K.shroom(2)]},
  'zombie': {'pal': K.ZOMBIE_PAL, 'variants': K.ZOMBIE_VAR, 'frames': [K.zombie(0), K.zombie(1), K.zombie(2)]},
  'spider': {'pal': N.SPIDER_PAL, 'variants': N.SPIDER_VAR, 'frames': [N.spider(0), N.spider(1), N.spider(2)]},
  'imp': {'pal': N.IMP_PAL, 'variants': N.IMP_VAR, 'frames': [N.imp(0), N.imp(1), N.imp(2)]},
  'salamander': {'pal': N.SALA_PAL, 'variants': N.SALA_VAR, 'frames': [N.salamander(0), N.salamander(1)]},
  'elemental': {'pal': N.ELEM_PAL, 'variants': N.ELEM_VAR, 'frames': [N.elemental(0), N.elemental(1), N.elemental(2)]},
  'mother': {'pal': N.MOTHER_PAL, 'frames': [N.mother(0), N.mother(1), N.mother(2)]},
  'skeleton': {'pal': N.SKEL_PAL, 'frames': [N.skeleton(0), N.skeleton(1), N.skeleton(2)]},
  'rat': {'pal': Y.RAT_PAL, 'frames': [Y.rat(0), Y.rat(1), Y.rat(2)]},
  'turtle': {'pal': Y.TURTLE_PAL, 'frames': [Y.turtle(0), Y.turtle(1), Y.turtle(2)]},
  'rabbit': {'pal': Y.RABBIT_PAL, 'frames': [Y.rabbit(0), Y.rabbit(1), Y.rabbit(2)]},
  'squirrel': {'pal': Y.SQUIRREL_PAL, 'frames': [Y.squirrel(0), Y.squirrel(1), Y.squirrel(2)]},
  'slime': {'pal': Y.SLIME_PAL, 'frames': [Y.slime(0), Y.slime(1), Y.slime(2)]},
  'skeleton_archer': {'pal': Y.SKEL_PAL, 'frames': [Y.skeleton_archer(0), Y.skeleton_archer(1), Y.skeleton_archer(2)]},
  'horse': {'pal': Y.HORSE_PAL, 'frames': [Y.horse(0), Y.horse(1)]},
  'bird': {'pal': Y.BIRD_PAL, 'variants': Y.BIRD_VAR, 'frames': [Y.bird(0), Y.bird(1)]},
}
if __name__ == '__main__':
    only = sys.argv[1].split(',') if len(sys.argv) > 1 else list(SPR)
    sheet({k: SPR[k] for k in only}, sys.argv[2] if len(sys.argv) > 2 else 'preview.png', 5)
