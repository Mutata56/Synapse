/**
 * ClusterHullManager: жидкие "metaball" оболочки кластеров на GPU.
 *
 * Реализует спеку cluster-hull (v2.4.0): вместо выпуклых оболочек и
 * Catmull-Rom сплайнов на CPU считаем каждый узел радиальным ЯДРОМ ПЛОТНОСТИ и
 * вытаскиваем изоповерхность F(P) = T на GPU.
 *
 *   1. Поле плотности (§1). Каждый узел даёт спадающий радиальный потенциал
 *      (затухание в духе Wyvill, тут приближено canvas-текстурой с радиальным
 *      градиентом). Поле в пикселе это СУММА всех ядер, что его накрывают. Где
 *      два кластера сближаются, их поля складываются и изоповерхность выпирает
 *      наружу: ещё до физического касания узлов появляется органичный "мостик".
 *
 *   2. Пайплайн (§2). Спрайты ядер рисуем в офскрин RenderTexture (НЕ на экран).
 *      Tint спрайта несёт RGB кластера, alpha это затухание. Перекрытые ядра
 *      разных кластеров смешивают цвета прямо в текстуре, так что шов между
 *      папками выходит плавным цветовым градиентом.
 *
 *   3. Шейдер порога (§3). Свой Filter на выходном спрайте читает накопленную
 *      alpha (плотность) на пиксель: ниже порога делаем `discard` (полностью
 *      прозрачно, быстро), у порога сглаженный край через `smoothstep`. Цвет
 *      нормируем на плотность (rgb / a), снимая premultiply, чтобы зоны
 *      смешения остались сочными, а не темнели.
 *
 *   4. Производительность (§5). RenderTexture с `resolution < 1` (при 0.5 в 4
 *      раза меньше пикселей), размытие поля прячет низкое разрешение. Один
 *      фильтрованный полноэкранный спрайт это одна лишняя отрисовка, а не по
 *      одной на кластер.
 *
 * Камера. Граф живёт в `world` Container с панорамой и зумом, а RenderTexture
 * размером с экран. Поэтому каждый кадр зеркалим трансформ world на (отдельный)
 * слой ядер перед рендером в текстуру. Выходной спрайт сидит в экранных
 * координатах под world и ложится 1:1 на чёткие векторные узлы поверх него.
 */
import {
  Container,
  Filter,
  GlProgram,
  type Renderer,
  RenderTexture,
  Sprite,
  Texture,
  UniformGroup,
} from "pixi.js";

/** Мировые px, добавляемые к радиусу влияния каждого узла (ядра должны щедро
 *  перекрывать соседей, чтобы кластер читался одним блобом, а не точками). */
export const KERNEL_PAD = 52;
/** Полуразмер (px) процедурной градиентной текстуры; вся текстура вдвое больше. */
const GRADIENT_HALF = 128;

// Стандартный вершинный шейдер фильтра Pixi v8 (ES 3.00): кладёт квад фильтра в clip space.
const VERTEX = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}
void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}
`;

// Шейдер порога / изоповерхности (ES 3.00, спека §3). `uTexture` это буфер
// плотности, его alpha это суммарное поле. Ниже полосы делаем discard, край
// сглаживаем через smoothstep, цвет нормируем на плотность (снимаем premultiply),
// чтобы зоны смешения цветов читались верно, а не темнели.
//
// Подсветка края (v3): мягкая ВНУТРЕННЯЯ полоса блика, чистый smoothstep в
// пространстве края, без лишних выборок текстуры и без зависимости от
// `textureSize()`. Прежний направленный вариант (выборки градиента вдоль
// uLightDir) ронял весь фильтр на части драйверов, блобы пропадали. Эта версия
// проще: ровно яркая на внутреннем крае каждого блоба, всё ещё добавляет "3D"
// глубину капли и ВСЕГДА компилируется. Направленное затенение по-прежнему есть
// через слагаемое `shade` (по плотности) ниже.
const FRAGMENT = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uThreshold;    // уровень изоповерхности (точка слияния)
uniform float uSoftness;     // полуширина сглаженной полосы края
uniform float uAlpha;        // итоговая непрозрачность жидкой подложки
uniform float uRimWidth;     // ширина полосы края, в пространстве edge (0..1)
uniform float uRimStrength;  // 0 = без блика, 1 = белый блик во всю полосу

void main(void) {
  vec4 tex = texture(uTexture, vTextureCoord);
  float density = tex.a;
  if (density < (uThreshold - uSoftness)) {
    discard; // целиком вне оболочки, отбрасываем рано (срезает ореол блюра, без квадрата)
  }
  float edge = smoothstep(uThreshold - uSoftness, uThreshold + uSoftness, density);
  vec3 color = tex.rgb / max(density, 0.001); // снимаем premultiply, зоны смешения сочнее
  // Глубина: ярче там, где поле плотное (ядро капли), темнее к краю (чуть выше
  // порога), даёт мягкую 3D "жидкую" фаску вместо плоской заливки.
  float shade = clamp((density - uThreshold) / max(1.0 - uThreshold, 0.001), 0.0, 1.0);
  color *= 0.62 + 0.62 * shade;
  // Полоса края: тонкая лента сразу ВНУТРИ изолинии, низкий edge это внешний
  // край, высокий это ядро. Оба конца окна smoothstep меньше uRimWidth*2, так
  // что край остаётся в безопасной зоне сохранённых фрагментов (паддинг тот же).
  float rimBand = smoothstep(0.0, uRimWidth, edge)
                * (1.0 - smoothstep(uRimWidth, uRimWidth * 2.0, edge));
  vec3 rimColor = mix(color, vec3(1.0), 0.65); // отбеленный tint, оттенок ещё читается
  color = mix(color, rimColor, rimBand * uRimStrength);
  float a = edge * uAlpha;
  finalColor = vec4(color * a, a); // premultiplied выход (Pixi его ожидает)
}
`;

/** Минимум, что нужен менеджеру от узла: мировая позиция и флаг active. */
export interface HullKernelNode {
  x: number;
  y: number;
  active: boolean;
}

export interface ClusterHullOptions {
  /** Радиус диска на узел (индекс совпадает с массивом узлов). */
  radii: readonly number[];
  /** Цвет кластера на узел (по индексу). Узлы вне кластеров игнорируем. */
  colors: readonly number[];
  /** Флаг на узел: входит ли он в кластер (получает ли ядро)? */
  clustered: readonly boolean[];
  /** Стартовые threshold / softness / fill (опционально, разумные дефолты ниже). */
  threshold?: number;
  softness?: number;
  alpha?: number;
  /** Ширина блика края в пространстве `edge` (домен smoothstep). Дефолт 0.18. */
  rimWidth?: number;
  /** Сила аддитивного отбеливания блика. Дефолт 0.55. */
  rimStrength?: number;
}

export class ClusterHullManager {
  /** Экранный спрайт с полем после порога. Монтировать ПОД `world`. */
  readonly output: Sprite;

  private readonly renderer: Renderer;
  private readonly layer: Container; // отдельный контейнер ядер, синхронен с камерой
  private readonly blob: Texture; // общая текстура ядра (радиальный градиент)
  private readonly kernels: Sprite[] = [];
  private readonly baseScale: number[] = []; // масштаб ядра при spread = 1
  private readonly clustered: readonly boolean[];
  private readonly filter: Filter;
  private readonly uniforms: UniformGroup;
  private readonly resolution: number; // нативное разрешение буфера (чётко, без блюра от апскейла)
  private rt: RenderTexture;
  private spread = 1; // живой множитель радиуса ядра (растёт с отталкиванием)

  constructor(
    renderer: Renderer,
    width: number,
    height: number,
    opts: ClusterHullOptions,
  ) {
    this.renderer = renderer;
    this.clustered = opts.clustered;
    this.blob = this.createGradientTexture(GRADIENT_HALF);

    // ── Офскрин-буфер плотности и выходной спрайт после порога ───────────────
    // Рендерим в НАТИВНОМ разрешении канваса. Уменьшенный буфер (0.5 из спеки)
    // апскейлится мутно, и мягкий край читается как уродливая размытая "рамка",
    // так что меняем экономию на производительности на чёткую изоповерхность.
    this.resolution = Math.min(renderer.resolution, 2); // 2x чётко для retina; высокие DPI режем
    this.rt = RenderTexture.create({ width, height, resolution: this.resolution });
    this.uniforms = new UniformGroup({
      uThreshold: { value: opts.threshold ?? 0.42, type: "f32" },
      uSoftness: { value: opts.softness ?? 0.02, type: "f32" },
      uAlpha: { value: opts.alpha ?? 0.42, type: "f32" },
      uRimWidth: { value: opts.rimWidth ?? 0.18, type: "f32" },
      uRimStrength: { value: opts.rimStrength ?? 0.55, type: "f32" },
    });
    this.filter = new Filter({
      glProgram: GlProgram.from({
        vertex: VERTEX,
        fragment: FRAGMENT,
        name: "cluster-metaball-threshold",
      }),
      resources: { metaballUniforms: this.uniforms },
    });
    this.output = new Sprite(this.rt);
    this.output.filters = [this.filter];
    this.filter.padding = 0; // полноэкранный спрайт, лишней области нет (избегаем полос по краю)

    // ── По одному ядру плотности на узел в кластере ──────────────────────────
    // Масштаб подгоняет градиентную текстуру так, что радиус влияния примерно
    // равен радиусу узла плюс pad (мировые px). Обычный blend (по умолчанию)
    // держит суммарную alpha не выше 1, 8-битный буфер не клампится, а перекрытия
    // всё равно переходят порог и сливаются.
    this.layer = new Container();
    const texW = this.blob.width;
    for (let i = 0; i < opts.radii.length; i++) {
      const s = new Sprite(this.blob);
      s.anchor.set(0.5);
      const scale = ((opts.radii[i] + KERNEL_PAD) * 2) / texW;
      this.baseScale.push(scale);
      s.scale.set(scale);
      s.tint = opts.colors[i];
      s.visible = false;
      this.layer.addChild(s);
      this.kernels.push(s);
    }
  }

  /**
   * Перекрашивает все ядра из нового массива цветов по узлам (индекс совпадает с
   * тем, что в конструкторе). Дёшево: только обновляем Sprite.tint, без пересборки
   * текстуры и геометрии, так что смена темы или живой перекрас кластера стоит
   * один кадр и не трогает позиции узлов, камеру и устоявшийся layout.
   */
  recolor(colors: readonly number[]): void {
    const n = Math.min(colors.length, this.kernels.length);
    for (let i = 0; i < n; i++) this.kernels[i].tint = colors[i];
  }

  /** Живая подстройка изоповерхности (например из панели настроек). */
  setUniforms(u: {
    threshold?: number;
    softness?: number;
    alpha?: number;
    rimWidth?: number;
    rimStrength?: number;
  }): void {
    const v = this.uniforms.uniforms as {
      uThreshold: number;
      uSoftness: number;
      uAlpha: number;
      uRimWidth: number;
      uRimStrength: number;
    };
    if (u.threshold !== undefined) v.uThreshold = u.threshold;
    if (u.softness !== undefined) v.uSoftness = u.softness;
    if (u.alpha !== undefined) v.uAlpha = u.alpha;
    if (u.rimWidth !== undefined) v.uRimWidth = u.rimWidth;
    if (u.rimStrength !== undefined) v.uRimStrength = u.rimStrength;
  }

  /** Пересоздаёт офскрин-буфер после ресайза канваса. */
  resize(width: number, height: number): void {
    const old = this.rt;
    this.rt = RenderTexture.create({ width, height, resolution: this.resolution });
    this.output.texture = this.rt;
    old.destroy(true);
  }

  /**
   * Синхронизирует ядра с текущими позициями узлов и трансформом камеры, потом
   * рендерит поле плотности в офскрин-буфер. Зовём каждый кадр, когда двигается
   * layout или камера (остальное делает шейдер порога на `output`, на GPU).
   *
   * @param nodes индекс совпадает с массивами из конструктора
   * @param scale world.scale.x
   * @param offsetX world.position.x (экранные px)
   * @param offsetY world.position.y (экранные px)
   */
  update(
    nodes: readonly HullKernelNode[],
    scale: number,
    offsetX: number,
    offsetY: number,
    spread = 1,
  ): void {
    // Растим/сжимаем каждое ядро при смене spread от отталкивания, чтобы блобы
    // не дырявились при расхождении узлов (ниже базового ядра не сжимаются).
    if (spread !== this.spread) {
      this.spread = spread;
      for (let i = 0; i < this.kernels.length; i++) {
        this.kernels[i].scale.set(this.baseScale[i] * spread);
      }
    }
    for (let i = 0; i < this.kernels.length; i++) {
      const n = nodes[i];
      const on = this.clustered[i] && n.active;
      const k = this.kernels[i];
      k.visible = on;
      if (on) k.position.set(n.x, n.y);
    }
    // Зеркалим камеру, чтобы ядра (в МИРОВЫХ координатах) попали в те же экранные
    // пиксели, что и чёткие узлы из `world` поверх выходного спрайта.
    this.layer.scale.set(scale);
    this.layer.position.set(offsetX, offsetY);
    this.renderer.render({
      container: this.layer,
      target: this.rt,
      clear: true,
      clearColor: [0, 0, 0, 0], // прозрачно, в буфер попадают только блобы
    });
  }

  destroy(): void {
    this.output.filters = [];
    this.output.destroy();
    this.layer.destroy({ children: true });
    this.rt.destroy(true);
    // `blob` может откатиться к общему Texture.WHITE, если 2D-контекст недоступен.
    // Этот глобальный синглтон уничтожать НЕЛЬЗЯ.
    if (this.blob !== Texture.WHITE) this.blob.destroy(true);
    this.filter.destroy();
  }

  // Процедурное ядро (радиальный градиент, спека §4): белое, чтобы цвет давал
  // TINT спрайта; alpha спадает от центра к краю, приближая потенциал Wyvill
  // (1 − r²)³ через стопы canvas-градиента.
  private createGradientTexture(half: number): Texture {
    const canvas = document.createElement("canvas");
    canvas.width = half * 2;
    canvas.height = half * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Texture.WHITE;
    const g = ctx.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0, "rgba(255,255,255,1.0)");
    g.addColorStop(0.3, "rgba(255,255,255,0.7)");
    g.addColorStop(0.7, "rgba(255,255,255,0.2)");
    g.addColorStop(1, "rgba(255,255,255,0.0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, half * 2, half * 2);
    return Texture.from(canvas);
  }
}
