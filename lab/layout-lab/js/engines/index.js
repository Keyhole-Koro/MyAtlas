// The engines on the bench, in the order of the cards.
import { layoutHand } from './hand.js';
import { layoutElk } from './elk.js';
import { layoutDagre } from './dagre.js';
import { layoutForce } from './force.js';
import { layoutSeq } from './seq.js';
import { layoutLanes } from './lanes.js';

export const ENGINES = [
  {
    id: 'hand', no: 1, name: '今の地図', short: '今の地図', lib: 'MyAtlas の今の配置（lab/reference から移植）',
    desc: '今の地図の置き方そのもの。層ごとの帯に、手順が最初に届く順で左から並べ、話す相手の方へ寄せる。線は直角で、候補から箱に当たらないものを選ぶ。札は空いた所に置き、入らない時は今の地図と同じく動詞か渡すデータを省く。比べる基準。',
    run: (D) => layoutHand(D),
  },
  {
    id: 'elk', no: 2, name: 'ELK（層を保つ）', short: 'ELK', lib: 'elkjs 0.12.1・layered',
    desc: '上から下へ、層ごとの区画（partition）に分けて段に並べる。線は直角、札の場所も ELK が先に取る。帯の中で続く手順は、縦に積まれる。',
    run: (D) => layoutElk(D, window.ELK),
  },
  {
    id: 'dagre', no: 3, name: 'dagre', short: 'dagre', lib: '@dagrejs/dagre 3.1.3',
    desc: '多くの作図ツールの既定。上から下へ段に並べ、札の場所を取り、線は曲線。層を知らないので、層は箱の色でしか分からない。実行の文脈は入れ子の枠にする。',
    run: (D) => layoutDagre(D, window.dagre),
  },
  {
    id: 'force', no: 4, name: '力学（帯に縛る）', short: '力学', lib: 'd3-force 3.0.1',
    desc: '箱どうしを反発させ、手順をばねにし、各箱を自分の層の帯に引きとめる。線は直線で、札は空いている所に置く。',
    run: (D) => layoutForce(D, window.d3),
  },
  {
    id: 'seq', no: 5, name: '時系列（シーケンス図）', short: '時系列', lib: '自前',
    desc: '箱を縦の線にして、手順を 1 行ずつ上から下へ並べる。交差は起きない。層は位置ではなく、箱の頭に書いた層の名前と色で分かる。手順の数だけ縦に伸びる。',
    run: (D) => layoutSeq(D),
  },
  {
    id: 'lanes', no: 6, name: '提案：帯の行と通り道', short: '提案', lib: '自前（このラボで作った配置）',
    desc: '今の地図と同じく層ごとの帯に置き、帯の中で続く手順は左から右への 1 行にする。札は矢印の上に置き、入らない時は行の上に吊る（点線で矢印につなぐ）。長い行は帯の中で折り返す。帯をまたぐ線は帯のあいだの通り道を自分の段で走り、遠回りと交差の少ない道を探して選ぶ。',
    run: (D) => layoutLanes(D),
  },
];
export const ENGINE = Object.fromEntries(ENGINES.map((e) => [e.id, e]));
