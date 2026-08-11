import { MigrationInterface, QueryRunner, Table, TableUnique } from 'typeorm';

/**
 * Las frases que la agencia cambia desde el panel.
 *
 * Solo lo editado: el texto de partida vive en el repositorio, asi que esta
 * tabla nace vacia y crece solo cuando alguien reescribe algo.
 */
export class Translations1786000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'translation',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
          { name: 'deleted_at', type: 'timestamptz', isNullable: true },
          { name: 'locale', type: 'varchar', length: '5' },
          { name: 'key', type: 'varchar', length: '160' },
          { name: 'value', type: 'text' },
        ],
      }),
      true,
    );

    await queryRunner.createUniqueConstraint(
      'translation',
      new TableUnique({
        name: 'UQ_translation_locale_key',
        columnNames: ['locale', 'key'],
      }),
    );

    await queryRunner.query(
      'CREATE INDEX "IDX_translation_locale" ON "translation" ("locale")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('translation');
  }
}
