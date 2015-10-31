import isDefined from '../utils/isDefined';
import isFunction from 'lodash/lang/isFunction';
import isString from 'lodash/lang/isString';
import HttpMethod from './enums/httpMethod';
import Rack from '../rack/rack';
import ResponseType from './enums/responseType';
import Query from './query';
import url from 'url';
import Client from './client';
import Auth from './auth';
import DataPolicy from './enums/dataPolicy';
import { KinveyError } from './errors';
import RequestProperties from './requestProperties';
import Promise from 'bluebird';
import assign from 'lodash/object/assign';
import merge from 'lodash/object/merge';
import result from 'lodash/object/result';
import clone from 'lodash/lang/clone';
import indexBy from 'lodash/collection/indexBy';
import reduce from 'lodash/collection/reduce';
import { byteCount } from '../utils/string';
const customRequestPropertiesMaxBytes = 2000;
const maxIdsPerRequest = 200;
const defaultTimeout = 10000; // 10 seconds

export class Request {
  constructor(method = HttpMethod.GET, path = '', query, data, options = {}) {
    options = assign({
      auth: Auth.none,
      client: Client.sharedInstance(),
      dataPolicy: DataPolicy.CloudOnly,
      responseType: ResponseType.Text,
      timeout: defaultTimeout
    }, options);

    let client = options.client;

    // Validate options
    if (!(client instanceof Client)) {
      client = new Client(result(client, 'toJSON', client));
    }

    // Validate query
    if (query && !(query instanceof Query)) {
      query = new Query(result(query, 'toJSON', query));
    }

    // Set request info
    this.method = method;
    this.headers = {};
    this.requestProperties = options.requestProperties;
    this.protocol = options.client.apiProtocol;
    this.host = options.client.apiHost;
    this.path = path;
    this.query = query;
    this.flags = options.flags;
    this.data = data;
    this.responseType = options.responseType;
    this.client = options.client;
    this.auth = options.auth;
    this.dataPolicy = options.dataPolicy;
    this.timeout = options.timeout;
    this.executing = false;

    // Add default headers
    const headers = {};
    headers.Accept = 'application/json';
    headers['X-Kinvey-Api-Version'] = process.env.KINVEY_API_VERSION;
    headers['X-Kinvey-Device-Information'] = {};

    if (options.contentType) {
      headers['X-Kinvey-Content-Type'] = options.contentType;
    }

    if (options.skipBL === true) {
      headers['X-Kinvey-Skip-Business-Logic'] = true;
    }

    if (options.trace === true) {
      headers['X-Kinvey-Include-Headers-In-Response'] = 'X-Kinvey-Request-Id';
      headers['X-Kinvey-ResponseWrapper'] = true;
    }

    this.addHeaders(headers);
  }

  get method() {
    return this._method;
  }

  set method(method) {
    if (!isString(method)) {
      method = String(method);
    }

    // Make the method uppercase
    method = method.toUpperCase();

    switch (method) {
    case HttpMethod.GET:
    case HttpMethod.POST:
    case HttpMethod.PATCH:
    case HttpMethod.PUT:
    case HttpMethod.DELETE:
      this._method = method;
      break;
    default:
      throw new KinveyError('Invalid Http Method. GET, POST, PATCH, PUT, and DELETE are allowed.');
    }
  }

  get requestProperties() {
    return this._requestProperties;
  }

  set requestProperties(requestProperties) {
    if (!(requestProperties instanceof RequestProperties)) {
      requestProperties = new RequestProperties(result(requestProperties, 'toJSON', requestProperties));
    }

    const appVersion = requestProperties.appVersion;

    if (appVersion) {
      this.setHeader('X-Kinvey-Client-App-Version', appVersion);
    } else {
      this.removeHeader('X-Kinvey-Client-App-Version');
    }

    const customRequestProperties = result(requestProperties, 'toJSON', {});
    delete customRequestProperties.appVersion;
    const customRequestPropertiesHeader = JSON.stringify(requestProperties.toJSON());
    const customRequestPropertiesByteCount = byteCount(customRequestPropertiesHeader);

    if (customRequestPropertiesByteCount >= customRequestPropertiesMaxBytes) {
      throw new KinveyError(`The custom request properties are ${customRequestPropertiesByteCount}. It must be less then ${customRequestPropertiesMaxBytes} bytes.`, 'Please remove some custom request properties.');
    }

    this.setHeader('X-Kinvey-Custom-Request-Properties', customRequestPropertiesHeader);
    this._requestProperties = requestProperties;
  }

  get url() {
    return url.format({
      protocol: this.protocol,
      host: this.host,
      pathname: this.path,
      query: merge({}, this.flags, result(this.query, 'toJSON', {})),
      hash: this.hash
    });
  }

  get body() {
    return this._data;
  }

  set body(body) {
    if (body) {
      const contentTypeHeader = this.getHeader('Content-Type');

      if (!contentTypeHeader) {
        this.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
    } else {
      this.removeHeader('Content-Type');
    }

    this._data = body;
  }

  get data() {
    return this._data;
  }

  set data(data) {
    if (data) {
      const contentTypeHeader = this.getHeader('Content-Type');

      if (!contentTypeHeader) {
        this.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
    } else {
      this.removeHeader('Content-Type');
    }

    this._data = data;
  }

  get responseType() {
    return this._responseType;
  }

  set responseType(type) {
    type = type || ResponseType.DOMString;
    let responseType;

    switch (type) {
    case ResponseType.Blob:
      try {
        responseType = new global.Blob() && 'blob';
      } catch (e) {
        responseType = 'arraybuffer';
      }

      break;
    case ResponseType.Document:
      responseType = 'document';
      break;
    case ResponseType.JSON:
      responseType = 'json';
      break;
    default:
      responseType = '';
    }

    this._responseType = responseType;
  }

  getHeader(header) {
    if (!isString(header)) {
      header = String(header);
    }

    const keys = Object.keys(this.headers);

    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];

      if (key.toLowerCase() === header.toLowerCase()) {
        return this.headers[key];
      }
    }

    return undefined;
  }

  setHeader(header, value) {
    if (!isString(header)) {
      header = String(header);
    }

    if (!isString(value)) {
      value = String(value);
    }

    const headers = this.headers;
    headers[header.toLowerCase()] = value;
    this.headers = headers;
  }

  addHeaders(headers = {}) {
    const keys = Object.keys(headers);

    keys.forEach((header) => {
      const value = headers[header];
      this.setHeader(header, value);
    });
  }

  removeHeader(header) {
    delete this.headers[header.toLowerCase()];
  }

  execute() {
    if (this.executing) {
      return Promise.reject(new KinveyError('The request is already executing.'));
    }

    let promise;
    this.executing = true;

    if (this.dataPolicy === DataPolicy.LocalOnly) {
      promise = this.executeLocal();
    } else if (this.dataPolicy === DataPolicy.LocalFirst) {
      promise = this.executeLocal().then(response => {
        if (response && response.isSuccess()) {
          if (this.method !== HttpMethod.GET) {
            const request = new Request(this.method, this.path, this.query, response.data, {
              auth: this.auth,
              client: this.client,
              dataPolicy: DataPolicy.CloudOnly
            });
            return request.execute().then(() => {
              return response;
            });
          }
        } else {
          if (this.method === HttpMethod.GET) {
            const request = new Request(this.method, this.path, this.query, response.data, {
              auth: this.auth,
              client: this.client,
              dataPolicy: DataPolicy.CloudFirst
            });
            return request.execute();
          }
        }

        return response;
      });
    } else if (this.dataPolicy === DataPolicy.CloudOnly) {
      promise = this.executeCloud();
    } else if (this.dataPolicy === DataPolicy.CloudFirst) {
      promise = this.executeCloud().then(response => {
        if (response && response.isSuccess()) {
          const request = new Request(this.method, this.path, this.query, response.data, {
            auth: this.auth,
            client: this.client,
            dataPolicy: DataPolicy.LocalOnly
          });

          if (this.method === HttpMethod.GET) {
            request.method = HttpMethod.PUT;
          }

          return request.execute().then(() => {
            return response;
          });
        } else if (this.method === HttpMethod.GET) {
          const request = new Request(this.method, this.path, this.query, response.data, {
            auth: this.auth,
            client: this.client,
            dataPolicy: DataPolicy.LocalOnly
          });
          return request.execute();
        }

        return response;
      });
    }

    return promise.then(response => {
      this.response = response;
      return response;
    }).finally(() => {
      this.executing = false;
    });
  }

  executeLocal() {
    const rack = Rack.cacheRack;
    return rack.execute(this);
  }

  executeCloud() {
    const auth = this.auth;
    const rack = Rack.networkRack;
    let promise = Promise.resolve();

    return promise.then(() => {
      if (isDefined(auth)) {
        promise = isFunction(auth) ? auth(this.client) : Promise.resolve(auth);

        // Add auth info to headers
        return promise.then((authInfo) => {
          if (authInfo !== null) {
            // Format credentials
            let credentials = authInfo.credentials;
            if (isDefined(authInfo.username)) {
              credentials = new Buffer(`${authInfo.username}:${authInfo.password}`).toString('base64');
            }

            // Set the header
            this.setHeader('Authorization', `${authInfo.scheme} ${credentials}`);
          }
        });
      }
    }).then(() => {
      return rack.execute(this);
    });
  }

  abort() {
    // TODO
    throw new KinveyError('Method not supported');
  }

  toJSON() {
    // Create an object representing the request
    const json = {
      method: this.method,
      headers: this.headers,
      requestProperties: result(this.requestProperties, 'toJSON', null),
      url: this.url,
      path: this.path,
      query: result(this.query, 'toJSON', null),
      flags: this.flags,
      data: this.data,
      responseType: this.responseType,
      dataPolicy: this.dataPolicy,
      client: result(this.client, 'toJSON', null),
      timeout: this.timeout
    };

    // Return the json object
    return clone(json, true);
  }
}

export class DeltaSetRequest extends Request {
  execute() {
    if (this.executing) {
      return Promise.reject(new KinveyError('The request is already executing.'));
    }

    if (this.dataPolicy === DataPolicy.CloudFirst && this.method === HttpMethod.GET) {
      const origQuery = this.query;
      this.query = new Query();
      this.query.fields(['_id', '_kmd']);
      this.executing = true;

      return this.executeLocal().then(localResponse => {
        if (localResponse && localResponse.isSuccess()) {
          const localEntities = indexBy(localResponse.data, '_id');

          return this.executeCloud().then(cloudResponse => {
            if (cloudResponse && cloudResponse.isSuccess()) {
              const cloudEntities = indexBy(cloudResponse.data, '_id');

              for (const id in cloudEntities) {
                if (cloudEntities.hasOwnProperty(id)) {
                  const cloudEntity = cloudEntities[id];
                  const localEntity = localEntities[id];

                  // Push id onto delta set if local entity doesn't exist
                  if (cloudEntity && !localEntity) {
                    continue;
                  } else if (cloudEntity && localEntity) {
                    // Push id onto delta set if lmt differs
                    if (cloudEntity._kmd && localEntity._kmd && cloudEntity._kmd.lmt > localEntity._kmd.lmt) {
                      continue;
                    }
                  }

                  delete cloudEntities[id];
                }
              }

              const ids = Object.keys(cloudEntities);
              const promises = [];
              let i = 0;

              // Batch the requests to retrieve 200 items per request
              while (i < ids.length) {
                const query = new Query(origQuery.toJSON());
                query.contains('_id', ids.slice(i, ids.length > maxIdsPerRequest + i ? maxIdsPerRequest : ids.length));
                const request = new Request(this.method, this.path, query, null, {
                  auth: this.auth,
                  client: this.client,
                  dataPolicy: this.dataPolicy
                });
                promises.push(request.execute());

                i += maxIdsPerRequest;
              }

              // Reduce all the responses into one response
              return Promise.all(promises).then(responses => {
                const initialResponse = new Response(null, null, []);
                return reduce(responses, (result, response) => {
                  result.addHeaders(response.headers);
                  result.data.concat(response.data);
                  return result;
                }, initialResponse);
              }).finally(() => {
                this.executing = false;
              });
            }

            return super.execute();
          });
        }

        return super.execute();
      });
    }

    return super.execute();
  }
}
