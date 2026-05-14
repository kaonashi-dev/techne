import { describe, expect, test } from "bun:test";
import { TechneApplication, TechneApplicationContext, TechneFactory, TechneApplicationOptions, TechneHealthOptions, TechneShutdownOptions, loadTechneConfigFile, __resetTechneConfigCache, 
// legacy aliases
BnestApplication, BnestApplicationContext, BnestFactory, BnestApplicationOptions, BnestHealthOptions, BnestShutdownOptions, loadBnestConfigFile, __resetBnestConfigCache, } from "../src/core";
import { TechneConfig, defineTechneConfig, BnestConfig, defineBnestConfig, } from "../src/core/define-techne-config";
import type { TechneInterceptor, BnestInterceptor } from "../src/interfaces/interceptor.interface";
import { techne, bnest } from "../src/core";
// These types must compile against each other to prove they are aliases.
// Assigning a value of one alias type to the other would fail at type-check
// time if they ever diverged.
const _optionsAlias: TechneApplicationOptions = {} as BnestApplicationOptions;
const _healthAlias: TechneHealthOptions = {} as BnestHealthOptions;
const _shutdownAlias: TechneShutdownOptions = {} as BnestShutdownOptions;
const _configAlias: TechneConfig = {} as BnestConfig;
type _InterceptorAlias = TechneInterceptor extends BnestInterceptor ? true : false;
type _InterceptorAliasReverse = BnestInterceptor extends TechneInterceptor ? true : false;
const _interceptorOk: _InterceptorAlias = true;
const _interceptorOkR: _InterceptorAliasReverse = true;
void _optionsAlias;
void _healthAlias;
void _shutdownAlias;
void _configAlias;
void _interceptorOk;
void _interceptorOkR;
describe("Bnest → Techne compat aliases", () => {
    test("class aliases point at the same constructor", () => {
        expect(BnestFactory).toBe(TechneFactory);
        expect(BnestApplication).toBe(TechneApplication);
        expect(BnestApplicationContext).toBe(TechneApplicationContext);
    });
    test("function aliases share the same implementation", () => {
        expect(defineBnestConfig).toBe(defineTechneConfig);
        expect(loadBnestConfigFile).toBe(loadTechneConfigFile);
        expect(__resetBnestConfigCache).toBe(__resetTechneConfigCache);
    });
    test("bnest() and techne() are functionally equivalent (both return promises)", async () => {
        // We don't boot a real module here — just confirm both are callable
        // bindings of the same function type.
        expect(typeof bnest).toBe("function");
        expect(typeof techne).toBe("function");
        // `bnest` is a `const = techne` alias, so identity holds.
        expect(bnest).toBe(techne);
    });
    test("defineTechneConfig and defineBnestConfig are identity functions", () => {
        const cfg = { controllers: [], port: 4242 };
        expect(defineTechneConfig(cfg as any)).toBe(cfg);
        expect(defineBnestConfig(cfg as any)).toBe(cfg);
    });
});
