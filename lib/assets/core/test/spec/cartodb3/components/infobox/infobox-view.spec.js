var Infobox = require('../../../../../javascripts/cartodb3/components/infobox/infobox-factory');
var InfoboxView = require('../../../../../javascripts/cartodb3/components/infobox/infobox-view');
var InfoboxModel = require('../../../../../javascripts/cartodb3/components/infobox/infobox-model');
var InfoboxCollection = require('../../../../../javascripts/cartodb3/components/infobox/infobox-collection');

describe('components/infobox/infobox-view', function () {
  beforeEach(function () {
    var states = [
      {
        state: 'ready',
        createContentView: function () {
          return Infobox.createInfo({
            title: 'Info',
            body: 'Lorem ipsum dolor sit amet.',
            closable: false
          });
        }
      },
      {
        state: 'error',
        createContentView: function () {
          return Infobox.createWithAction({
            title: 'Error',
            body: 'Lorem ipsum dolor sit amet.',
            mainAction: {
              label: 'Confirm'
            }
          });
        },
        mainAction: function () {},
        closeAction: function () {}
      },
      {
        state: 'wadus',
        createContentView: function () {
          return Infobox.createWithAction({
            title: 'Wadus',
            body: 'Lorem ipsum dolor sit amet.',
            mainAction: {
              label: 'Confirm'
            }
          });
        },
        mainAction: function () {}
      }
    ];

    this.model = new InfoboxModel({
      state: 'ready',
      visible: true
    });

    this.view = new InfoboxView({
      infoboxModel: this.model,
      infoboxCollection: new InfoboxCollection(states)
    });

    this.view.render();
  });

  it('should render properly', function () {
    expect(this.view.infoboxView).toBeDefined();
    expect(this.view.$('.Infobox').length).toBe(1);
    expect(this.view.$('h2').text()).toBe('Info');
    expect(this.view.$('.js-close').length).toBe(0);

    this.model.set({state: 'error'});

    expect(this.view.$('h2').text()).toBe('Error');
    expect(this.view.$('.js-close').length).toBe(1);
    expect(this.view.$('.Infobox-buttons button').length).toBe(1);
  });

  it('should bind actions properly', function () {
    var model = this.view.infoboxCollection.at(1);
    spyOn(model.attributes, 'mainAction');
    spyOn(model.attributes, 'closeAction');

    this.model.set({state: 'error'});
    this.view.$('.Infobox-buttons button').trigger('click');

    expect(model.attributes.mainAction).toHaveBeenCalled();

    this.view.$('.js-close').trigger('click');
    expect(model.attributes.closeAction).toHaveBeenCalled();
  });

  it('should close the infobox', function () {
    this.model.set({state: 'wadus'});
    this.view.$('.js-close').trigger('click');
    expect(this.view.$el.html()).toBe('');
  });

  it('should not have any leaks', function () {
    expect(this.view).toHaveNoLeaks();
  });
});
