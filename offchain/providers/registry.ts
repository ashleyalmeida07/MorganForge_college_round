import { ChainAdapter } from '../chain/ChainAdapter';
import { HonestProvider } from './HonestProvider';
import { WrongResultProvider } from './WrongResultProvider';
import { LazyProvider } from './LazyProvider';
import { WrongInputProvider } from './WrongInputProvider';
import { SlowProvider } from './SlowProvider';
import { FlakyProvider } from './FlakyProvider';
import { BaseProvider } from './BaseProvider';

export function createProvider(name: string, address: string, chain: ChainAdapter): BaseProvider {
    const map: Record<string, any> = {
        'honest': HonestProvider,
        'wrongresult': WrongResultProvider,
        'lazy': LazyProvider,
        'wronginput': WrongInputProvider,
        'slow': SlowProvider,
        'flaky': FlakyProvider
    };
    
    const ProviderClass = map[name.toLowerCase()];
    if (!ProviderClass) throw new Error(`Unknown provider: ${name}`);
    
    return new ProviderClass(name, address, chain);
}