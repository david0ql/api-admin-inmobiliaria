import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssistantRule } from './domain/assistant-rule.entity';
import { AssistantSettings } from './domain/assistant-settings.entity';
import { RuleSource } from './domain/chat.enums';

/**
 * Cuánto de lo que escribe la agencia entra en el prompt.
 *
 * Un prompt sin freno crece hasta que el modelo deja de leerlo entero y empieza
 * a olvidarse de lo del medio. Con un tope, la agencia ve el aviso y decide qué
 * sobra, en lugar de que se degrade en silencio.
 */
const MAX_RULES = 40;
const MAX_POST_PROMPT = 4000;

@Injectable()
export class RulesService {
  constructor(
    @InjectRepository(AssistantRule)
    private readonly rules: Repository<AssistantRule>,
    @InjectRepository(AssistantSettings)
    private readonly settings: Repository<AssistantSettings>,
  ) {}

  list(): Promise<AssistantRule[]> {
    return this.rules.find({ order: { position: 'ASC', createdAt: 'ASC' } });
  }

  async create(
    text: string,
    source = RuleSource.MANUAL,
    reviewId?: string,
  ): Promise<AssistantRule> {
    const ultima = await this.rules.find({
      order: { position: 'DESC' },
      take: 1,
    });
    return this.rules.save(
      this.rules.create({
        text: text.trim(),
        source,
        reviewId: reviewId ?? null,
        position: (ultima[0]?.position ?? -1) + 1,
        active: true,
      }),
    );
  }

  async update(
    id: string,
    cambio: { text?: string; active?: boolean; position?: number },
  ): Promise<AssistantRule> {
    const regla = await this.rules.findOne({ where: { id } });
    if (!regla) throw new NotFoundException('Regla no encontrada');
    await this.rules.update({ id }, cambio);
    return (await this.rules.findOne({ where: { id } }))!;
  }

  async remove(id: string): Promise<void> {
    await this.rules.delete({ id });
  }

  async getSettings(): Promise<AssistantSettings> {
    const fila = await this.settings.findOne({ where: {} });
    return fila ?? this.settings.save(this.settings.create({ postPrompt: '' }));
  }

  async setPostPrompt(postPrompt: string): Promise<AssistantSettings> {
    const actual = await this.getSettings();
    await this.settings.update(
      { id: actual.id },
      { postPrompt: postPrompt.slice(0, MAX_POST_PROMPT) },
    );
    return this.getSettings();
  }

  /**
   * Lo que la agencia añade al prompt, ya montado.
   *
   * Primero las reglas —cada una salió de un fallo concreto— y al final el
   * texto libre. Va lo último porque lo último que lee un modelo es lo que más
   * le pesa, y ahí es donde la agencia debe poder pasar por encima de todo lo
   * anterior, incluido lo nuestro.
   */
  async promptExtra(): Promise<string> {
    const [reglas, settings] = await Promise.all([
      this.rules.find({
        where: { active: true },
        order: { position: 'ASC', createdAt: 'ASC' },
        take: MAX_RULES,
      }),
      this.getSettings(),
    ]);

    const partes: string[] = [];

    if (reglas.length) {
      partes.push(
        '',
        'REGLAS DE LA AGENCIA (cada una salió de una respuesta que no gustó; respétalas por encima de tus hábitos):',
        ...reglas.map((regla, i) => `${i + 1}. ${regla.text}`),
      );
    }

    const post = settings.postPrompt?.trim();
    if (post) {
      partes.push('', 'INSTRUCCIONES DE LA AGENCIA:', post);
    }

    return partes.join('\n');
  }
}
