import {
    FRASE_CORTESIA,
    FRASE_DECLINACION,
    FRASE_IDENTIDAD,
    FRASE_SOLO_LECTURA,
    INSTRUCCION_SISTEMA_CHAT,
} from './chat.prompt';

/**
 * Pruebas sobre el TEXTO del prompt del chat (SPEC 30).
 *
 * Comprueban que la frase de identidad existe, que no nombra al proveedor y
 * que viaja dentro de la regla principal y no en una seccion aparte. Lo que no
 * pueden comprobar es que el modelo la obedezca: eso solo se ve contra la API
 * real, y por eso los criterios de comportamiento del spec son manuales.
 */

describe('chat.prompt / identidad del asistente', () => {
    it('la frase nombra al asistente y a su autor', () => {
        expect(FRASE_IDENTIDAD).toContain('Agri');
        expect(FRASE_IDENTIDAD).toContain('Jesus Reyes');
    });

    it('la frase no nombra al modelo ni a su proveedor', () => {
        expect(FRASE_IDENTIDAD).not.toMatch(/gemini|google|modelo de lenguaje/i);
    });

    it('la instruccion empieza presentando a Agri', () => {
        expect(INSTRUCCION_SISTEMA_CHAT.startsWith('Eres Agri,')).toBe(true);
    });

    it('la instruccion lleva la frase literal dentro de la regla principal', () => {
        const posFrase = INSTRUCCION_SISTEMA_CHAT.indexOf(FRASE_IDENTIDAD);
        const posReglaPrincipal = INSTRUCCION_SISTEMA_CHAT.indexOf('REGLA PRINCIPAL');
        const posSoloLectura = INSTRUCCION_SISTEMA_CHAT.indexOf('SOLO LECTURA:');

        expect(posFrase).toBeGreaterThan(posReglaPrincipal);
        expect(posFrase).toBeLessThan(posSoloLectura);
    });

    it('la instruccion conserva las otras dos frases literales', () => {
        expect(INSTRUCCION_SISTEMA_CHAT).toContain(FRASE_DECLINACION);
        expect(INSTRUCCION_SISTEMA_CHAT).toContain(FRASE_SOLO_LECTURA);
    });
});

/**
 * Pruebas sobre el TEXTO de la excepcion de cortesia (SPEC 31). Igual que las
 * de arriba, comprueban donde vive la frase, no que el modelo la use: eso solo
 * se ve contra la API real.
 */
describe('chat.prompt / agradecimientos y despedidas', () => {
    it('la frase contesta al gracias y vuelve a ofrecer los lotes', () => {
        expect(FRASE_CORTESIA).toContain('Con gusto');
        expect(FRASE_CORTESIA).toContain('lote');
    });

    it('la frase no nombra al modelo ni a su proveedor', () => {
        expect(FRASE_CORTESIA).not.toMatch(/gemini|google|modelo de lenguaje/i);
    });

    it('la frase es distinta de las otras tres', () => {
        expect(FRASE_CORTESIA).not.toBe(FRASE_DECLINACION);
        expect(FRASE_CORTESIA).not.toBe(FRASE_SOLO_LECTURA);
        expect(FRASE_CORTESIA).not.toBe(FRASE_IDENTIDAD);
    });

    it('la instruccion lleva la frase literal', () => {
        expect(INSTRUCCION_SISTEMA_CHAT).toContain(FRASE_CORTESIA);
    });

    it('la frase va dentro de la regla principal, despues de la identidad', () => {
        const posCortesia = INSTRUCCION_SISTEMA_CHAT.indexOf(FRASE_CORTESIA);
        const posIdentidad = INSTRUCCION_SISTEMA_CHAT.indexOf(FRASE_IDENTIDAD);
        const posSoloLectura = INSTRUCCION_SISTEMA_CHAT.indexOf('SOLO LECTURA:');

        expect(posIdentidad).toBeGreaterThan(-1);
        expect(posCortesia).toBeGreaterThan(posIdentidad);
        expect(posCortesia).toBeLessThan(posSoloLectura);
    });

    it('la regla principal cuenta tres excepciones, no dos', () => {
        expect(INSTRUCCION_SISTEMA_CHAT).toContain('Hay solo tres excepciones');
        expect(INSTRUCCION_SISTEMA_CHAT).not.toContain('Hay solo dos excepciones');
    });

    it('la instruccion conserva las otras tres frases literales', () => {
        expect(INSTRUCCION_SISTEMA_CHAT).toContain(FRASE_DECLINACION);
        expect(INSTRUCCION_SISTEMA_CHAT).toContain(FRASE_SOLO_LECTURA);
        expect(INSTRUCCION_SISTEMA_CHAT).toContain(FRASE_IDENTIDAD);
    });
});
