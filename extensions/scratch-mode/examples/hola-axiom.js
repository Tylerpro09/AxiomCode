class HolaAxiomExtension {
  getInfo() {
    return {
      id: 'holaxiom',
      name: 'Hola Axiom',
      color1: '#22A06B',
      color2: '#1B8559',
      blocks: [
        {
          opcode: 'saludar',
          blockType: 'reporter',
          text: 'saludar a [NOMBRE]',
          arguments: {
            NOMBRE: {type: 'string', defaultValue: 'mundo'}
          }
        },
        {
          opcode: 'guardar',
          blockType: 'command',
          text: 'guardar [VALOR] con clave [CLAVE]',
          arguments: {
            VALOR: {type: 'string', defaultValue: '42'},
            CLAVE: {type: 'string', defaultValue: 'dato'}
          }
        }
      ]
    };
  }

  saludar(args) {
    return 'Hola, ' + String(args.NOMBRE || 'mundo') + '!';
  }

  async guardar(args) {
    await AxiomScratchSDK.power('storageSet', {
      key: String(args.CLAVE || ''),
      value: String(args.VALOR ?? '')
    });
  }
}

module.exports = HolaAxiomExtension;
