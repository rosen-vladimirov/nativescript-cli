import Rack from 'kinvey-rack';
import UrlPattern from 'url-pattern';
const urlPartsSymbol = Symbol();

class Middleware extends Rack.Middleware {
  get protocol() {
    return this[urlPartsSymbol].protocol;
  }

  constructor(name = 'Kinvey Middleware') {
    super(name);
  }

  handle(request) {
    return new Promise((resolve, reject) => {
      if (request) {
        const pattern = new UrlPattern('/:namespace/:appId/:collection(/)(:id)(/)');
        const matches = pattern.match(request.path);
        return resolve(matches);
      }

      reject(); // TODO: Give reason
    });
  }
}

export default Middleware;
