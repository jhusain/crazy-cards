import assert from "node:assert/strict";
import test from "node:test";
import { GameServer } from "@crazy-eights/game-server";
import { type TableView } from "@crazy-eights/protocol";
import { AutomaticActions, automaticPlay } from "../src/automatic-actions.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";
import { standardDeck } from "../../../packages/game-server/src/rules.ts";

const card=(rank:number,suit:string)=>standardDeck().find(card=>card.rank===rank&&card.suit===suit)!;
const snapshot=(changes:Partial<TableView>={}):TableView=>({...new GameServer().view(0),revision:1,turn:0,seat:0,
  hand:[card(6,"clubs"),card(4,"hearts")],visibleDiscard:[card(3,"clubs")],activeSuit:"clubs",legalLeads:[card(6,"clubs").id],...changes});
const settings={...DEFAULT_SETTINGS,autoPass:true,autoPickup:true,autoSingle:true};

test("autopass needs an unplayable voluntary draw and an opponent with cards",()=>{
  const actions=new AutomaticActions();
  const before=snapshot();
  const after=snapshot({revision:2,drewThisTurn:true,event:{seat:0,kind:"draw",drawCount:1,drawnCards:[card(4,"hearts").id]}});
  actions.record(before,after,{type:"draw"});
  assert.deepEqual(actions.next(after,{...settings,autoSingle:false}),{type:"pass"});
  assert.equal(actions.next({...after,opponentCount:0},{...settings,autoSingle:false}),undefined);
  actions.record(after,{...after,revision:3,event:{seat:0,kind:"draw",drawCount:1,drawnCards:[card(6,"clubs").id]}},{type:"draw"});
  assert.equal(actions.next({...after,revision:3},{...settings,autoSingle:false}),undefined);
});

test("auto pickup uses the previous passed choices and is invalidated by a penalty or play",()=>{
  const actions=new AutomaticActions();
  const passed=snapshot({drewThisTurn:true});
  const after=snapshot({revision:2,turn:1,event:{seat:0,kind:"pass"}});
  actions.record(passed,after,{type:"pass"});
  const next=snapshot({revision:3,event:{seat:1,kind:"play"}});
  actions.record(after,next);
  assert.deepEqual(actions.next(next,{...settings,autoSingle:false}),{type:"draw"});
  assert.equal(actions.next({...next,legalLeads:[...next.legalLeads,card(4,"hearts").id]},{...settings,autoSingle:false}),undefined);
  const penalty={...next,revision:4,event:{seat:1 as const,kind:"play" as const,penalty:{seat:0 as const,count:2}}};
  actions.record(next,penalty);
  assert.equal(actions.next(penalty,{...settings,autoSingle:false}),undefined);
});

test("automatic cards must be the sole non-excluded legal lead and match the active suit or rank",()=>{
  const actions=new AutomaticActions();
  const view=snapshot();
  assert.deepEqual(actions.next(view,settings),{type:"play",cards:[view.hand[0]]});
  assert.equal(actions.next({...view,hand:[...view.hand,card(6,"hearts")]},settings),undefined);
  assert.equal(actions.next({...view,legalLeads:[]},settings),undefined);
  assert.equal(actions.next({...view,legalLeads:view.hand.map(card=>card.id)},settings),undefined);
  assert.equal(actions.next(view,DEFAULT_SETTINGS),undefined);
  for(const [rank,key] of [[8,"autoSingleExcludeWild"],[2,"autoSingleExcludeTwo"],[12,"autoSingleExcludeQueen"]] as const){
    const candidate=card(rank,"spades");
    const v=snapshot({hand:[candidate],activeSuit:"spades",legalLeads:[candidate.id]});
    assert.deepEqual(actions.next(v,settings),{type:"play",cards:[candidate]});
    assert.deepEqual(actions.next(v,{...settings,[key]:true}),{type:"play",cards:[candidate]});
  }
  for(const rank of [1,11]){
    const candidate=card(rank,"clubs");
    const v=snapshot({hand:[candidate],legalLeads:[candidate.id]});
    assert.deepEqual(actions.next(v,settings),{type:"play",cards:[candidate]});
    assert.deepEqual(actions.next(v,{...settings,autoSingleSkips:true}),{type:"play",cards:[candidate]});
  }
});


test("a sole eligible rank-matching single can autoplay even when its suit differs",()=>{
  const match=card(3,"hearts");
  const view=snapshot({hand:[match,card(5,"diamonds")],legalLeads:[match.id]});
  assert.deepEqual(automaticPlay(view,settings),[match]);
  assert.equal(automaticPlay({...view,hand:[...view.hand,card(3,"diamonds")]},settings),undefined);
  const suit=card(6,"clubs");
  assert.equal(automaticPlay({...view,hand:[...view.hand,suit],legalLeads:[match.id,suit.id]},settings),undefined);
});

test("singleton skip prefixes follow hand order, without breaking a skip group",()=>{
  const jack=card(11,"clubs"), ace=card(1,"clubs"), four=card(4,"clubs");
  const view=snapshot({hand:[jack,ace,four],legalLeads:[jack.id,ace.id,four.id]});
  assert.equal(automaticPlay(view,settings),undefined);
  const prefixed={...settings,autoSingleSkips:true};
  assert.deepEqual(automaticPlay(view,prefixed),[jack,ace,four]);
  assert.deepEqual(automaticPlay({...view,hand:[ace,jack,four]},prefixed),[ace,jack,four]);
  assert.equal(automaticPlay({...view,hand:[jack,card(1,"diamonds"),ace,four]},prefixed),undefined);
  assert.equal(automaticPlay({...view,hand:[jack,ace,four,card(4,"diamonds")]},prefixed),undefined);
  const rankMatch=card(3,"hearts");
  assert.equal(automaticPlay({...view,hand:[jack,rankMatch],legalLeads:[jack.id,rankMatch.id]},prefixed),undefined);
});

test("excluded legal cards are not automatic choices and do not block the only eligible single",()=>{
  const four=card(4,"clubs"), eight=card(8,"clubs");
  const view=snapshot({hand:[four,eight],legalLeads:[four.id,eight.id]});
  assert.equal(automaticPlay(view,settings),undefined);
  assert.deepEqual(automaticPlay(view,{...settings,autoSingleExcludeWild:true}),[four]);
  assert.deepEqual(automaticPlay({...view,hand:[eight],legalLeads:[eight.id]},{...settings,autoSingleExcludeWild:true}),[eight]);
});


test("rank-matched skips remain competing choices instead of being silently ignored",()=>{
  const jack=card(11,"hearts"), five=card(5,"clubs"), ace=card(1,"clubs");
  const top=card(11,"clubs");
  const view=snapshot({visibleDiscard:[top],hand:[jack,five],legalLeads:[jack.id,five.id]});
  for(const autoSingleSkips of [false,true]) {
    assert.equal(automaticPlay(view,{...settings,autoSingleSkips}),undefined);
    assert.deepEqual(automaticPlay({...view,hand:[jack],legalLeads:[jack.id]},{...settings,autoSingleSkips}),[jack]);
  }
  const sameSuit={...view,hand:[ace,five],legalLeads:[ace.id,five.id]};
  assert.deepEqual(automaticPlay(sameSuit,{...settings,autoSingleSkips:true}),[ace,five]);
  assert.equal(automaticPlay(sameSuit,{...settings,autoSingleSkips:false}),undefined);
});


test("eligible groups block autoplay with either skip-prefix setting",()=>{
  const four=card(4,"clubs"), jack=card(11,"clubs"), otherJack=card(11,"hearts");
  const view=snapshot({visibleDiscard:[jack],hand:[four,jack,otherJack],legalLeads:[four.id,jack.id,otherJack.id]});
  for(const autoSingleSkips of [false,true]) {
    assert.equal(automaticPlay(view,{...settings,autoSingleSkips}),undefined);
    const ordinaryGroup={...view,visibleDiscard:[four],hand:[jack,four,card(4,"hearts")],legalLeads:[jack.id,four.id,card(4,"hearts").id]};
    assert.equal(automaticPlay(ordinaryGroup,{...settings,autoSingleSkips}),undefined);
  }
});

test("the sole eligible card cannot play if an unplayable card shares its face",()=>{
  const four=card(4,"clubs"), otherFour=card(4,"diamonds");
  const view=snapshot({hand:[four,otherFour],legalLeads:[four.id]});
  for(const autoSingleSkips of [false,true]) assert.equal(automaticPlay(view,{...settings,autoSingleSkips}),undefined);
});


test("all exclusions yield to a legal last card, while still excluding it with other cards in hand",()=>{
  const allExcluded={...settings,autoSingleExcludeWild:true,autoSingleExcludeTwo:true,autoSingleExcludeQueen:true};
  const actions=new AutomaticActions();
  for(const candidate of [card(8,"hearts"),card(2,"clubs"),card(12,"spades")]) {
    const view=snapshot({hand:[candidate],legalLeads:[candidate.id]});
    assert.deepEqual(automaticPlay(view,allExcluded),[candidate]);
    assert.deepEqual(actions.next(view,allExcluded),{type:"play",cards:[candidate]});
    assert.equal(automaticPlay({...view,legalLeads:[]},allExcluded),undefined);
    assert.equal(automaticPlay({...view,hand:[candidate,card(6,"diamonds")]},allExcluded),undefined);
    assert.equal(automaticPlay(view,{...allExcluded,autoSingle:false}),undefined);
  }
});


test("an excluded queen of spades still prevents other queens from being singles",()=>{
  const queen=card(12,"diamonds"), spades=card(12,"spades"), jack=card(11,"diamonds");
  const view=snapshot({activeSuit:"diamonds",visibleDiscard:[card(3,"diamonds")],hand:[queen,spades],legalLeads:[queen.id,spades.id]});
  for(const autoSingleSkips of [false,true]) {
    const config={...settings,autoSingleExcludeQueen:true,autoSingleSkips};
    assert.equal(automaticPlay(view,config),undefined);
    assert.equal(automaticPlay({...view,hand:[jack,queen,spades],legalLeads:[jack.id,queen.id,spades.id]},config),undefined);
    assert.deepEqual(automaticPlay({...view,hand:[queen],legalLeads:[queen.id]},config),[queen]);
    assert.deepEqual(automaticPlay({...view,hand:[spades],legalLeads:[spades.id]},config),[spades]);
  }
});


test("two exclusion yields to a top two, but competing eligible cards and two groups still block autoplay",()=>{
  const two=card(2,"clubs"), seven=card(7,"diamonds");
  const view=snapshot({activeSuit:"diamonds",visibleDiscard:[card(2,"diamonds")],hand:[two,card(6,"hearts")],legalLeads:[two.id]});
  for(const autoSingleSkips of [false,true]) {
    const config={...settings,autoSingleExcludeTwo:true,autoSingleSkips};
    assert.deepEqual(automaticPlay(view,config),[two]);
    assert.equal(automaticPlay({...view,hand:[two,seven],legalLeads:[two.id,seven.id]},config),undefined);
    assert.equal(automaticPlay({...view,hand:[two,card(2,"hearts")],legalLeads:[two.id,card(2,"hearts").id]},config),undefined);
    assert.equal(automaticPlay({...view,visibleDiscard:[card(3,"clubs")],activeSuit:"clubs"},config),undefined);
    assert.deepEqual(automaticPlay({...view,visibleDiscard:[card(3,"clubs")],activeSuit:"clubs",hand:[two]},config),[two]);
  }
});
