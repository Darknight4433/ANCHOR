/* eslint-env jest */

const CargoManager = require('../src/CargoManager.js');

describe('CargoManager (Container-First)', () => {
  let cargo;

  beforeAll(async () => {
    cargo = new CargoManager();
    await cargo.initialize();
  });

  it('should initialize and select a runtime', () => {
    expect(cargo.useDocker !== undefined).toBe(true);
  });

  it('should create a process cargo properly', async () => {
    // Force Process mode for test safely without docker requirements
    cargo.useDocker = false; 
    
    const workload = await cargo.createCargo('test-workload', 'node -e "console.log(1)"', {
        env: { TEST_VAR: '123' }
    });
    
    expect(workload.status).toBe('created');
    expect(workload.type).toBe('process');
    expect(cargo.cargos.has('test-workload')).toBe(true);
  });

  it('should remove cargo safely', async () => {
    cargo.useDocker = false;
    await cargo.removeCargo('test-workload');
    expect(cargo.cargos.has('test-workload')).toBe(false);
  });
});
