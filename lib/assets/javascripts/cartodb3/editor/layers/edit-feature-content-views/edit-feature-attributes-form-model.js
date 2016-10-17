var Backbone = require('backbone');
var _ = require('underscore');
var DEBOUNCE_TIME = 350;

var FIELDTYPE_TO_FORMTYPE = {
  string: 'Text',
  boolean: 'Text',
  number: 'Number',
  date: 'Text',
  geometry: 'Text'
};

var BLACKLISTED_COLUMNS = ['created_at', 'the_geom', 'the_geom_webmercator', 'updated_at'];

module.exports = Backbone.Model.extend({

  initialize: function (attrs, opts) {
    if (!opts.featureModel) throw new Error('featureModel is required');
    if (!opts.columnsCollection) throw new Error('columnsCollection is required');

    this._featureModel = opts.featureModel;
    this._columnsCollection = opts.columnsCollection;

    this._generateSchema();
    this._initBinds();
  },

  _initBinds: function () {
    this.bind('change', _.debounce(this._onChange.bind(this), DEBOUNCE_TIME), this);
  },

  _onChange: function () {
    var self = this;

    _.each(this.changed, function (val, key) {
      // if the attr doesn't exist in the featureModel it will be created, BOOM
      self._featureModel.set(key, val);
    });
  },

  _generateSchema: function () {
    this.schema = {};

    this._columnsCollection.each(function (mdl) {
      var columnName = mdl.get('name');
      var columnType = mdl.get('type');

      if (!_.contains(BLACKLISTED_COLUMNS, columnName)) {
        this.schema[columnName] = {
          type: FIELDTYPE_TO_FORMTYPE[columnType],
          validators: ['required']
        };

        if (columnType === 'number') {
          this.schema[columnName].showSlider = false;
        }

        if (columnName === 'cartodb_id') {
          this.schema[columnName].editorAttrs = {
            disabled: true
          };
        }
      }
    }, this);
  }

});